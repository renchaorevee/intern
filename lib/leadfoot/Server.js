define([
	'dojo/Deferred',
	'dojo/lang',
	'dojo/request',
	'dojo/promise/all',
	'./statusCodes',
	'./Session'
], function (Deferred, lang, request, whenAll, statusCodes, Session) {
	function createHttpRequest(method) {
		/*jshint node:true */
		return function (path, requestData, pathParts) {
			var url = this.url + path.replace(/\$(\d)/, function (_, index) {
				return encodeURIComponent(pathParts[index]);
			});

			var kwArgs = {
				handleAs: 'text',
				headers: {
					// At least FirefoxDriver on Selenium 2.40.0 will throw a NullPointerException when retrieving
					// session capabilities if an Accept header is not provided. (It is a good idea to provide one
					// anyway)
					'Accept': 'application/json,text/plain;q=0.9'
				},
				method: method
			};

			if (requestData) {
				kwArgs.data = JSON.stringify(requestData);
				kwArgs.headers['Content-Type'] = 'application/json;charset=UTF-8';
				// At least ChromeDriver 2.9.248307 will not process request data if the length of the data is not
				// provided. (It is a good idea to provide one anyway)
				kwArgs.headers['Content-Length'] = Buffer.byteLength(kwArgs.data, 'utf8');
			}

			return request(url, kwArgs).response.then(function handleResponse(response) {
				/*jshint maxcomplexity:20 */
				// The JsonWireProtocol specification prior to June 2013 stated that creating a new session should
				// perform a 3xx redirect to the session capabilities URL, instead of simply returning the returning
				// data about the session; as a result, we need to follow all redirects to get consistent data
				if (response.status >= 300 && response.status < 400 && response.getHeader('Location')) {
					return request(response.getHeader('Location'), {
						method: 'GET'
					}).response.always(handleResponse);
				}

				var responseType = response.getHeader('Content-Type');
				var data;

				if (responseType && responseType.indexOf('application/json') === 0 && response.text) {
					data = JSON.parse(response.text);
				}

				// Some drivers will respond to a DELETE request with 204; in this case, we know the operation
				// completed successfully, so just create an expected response data structure for a successful
				// operation to avoid any special conditions elsewhere in the code caused by different HTTP return
				// values
				if (response.status === 204) {
					data = {
						status: 0,
						sessionId: null,
						value: null
					};
				}
				else if (response.status >= 400 || (data && data.status > 0)) {
					var error = new Error();

					// "The client should interpret a 404 Not Found response from the server as an "Unknown command"
					// response. All other 4xx and 5xx responses from the server that do not define a status field
					// should be interpreted as "Unknown error" responses."
					// - http://code.google.com/p/selenium/wiki/JsonWireProtocol#Response_Status_Codes
					if (!data) {
						data = {
							status: response.status === 404 || response.status === 501 ? 9 : 13,
							value: {
								message: response.text
							}
						};
					}
					// ios-driver 0.6.6-pre incorrectly implements the specification: does not return error data
					// on the `value` key, and does not return the correct HTTP status for unknown commands
					else if (!data.value && ('message' in data)) {
						data = {
							status: response.status === 404 || response.status === 501 ||
								data.message.indexOf('cannot find command') > -1 ? 9 : 13,
							value: data
						};
					}

					// At least Appium April 2014 responds with the HTTP status Not Implemented but a Selenium
					// status UnknownError for commands that are not implemented; these errors are more properly
					// represented to end-users using the Selenium status UnknownCommand, so we make the appropriate
					// coercion here
					if (response.status === 501 && data.status === 13) {
						data.status = 9;
					}

					// At least FirefoxDriver 2.40.0 responds with HTTP status codes other than Not Implemented and a
					// Selenium status UnknownError for commands that are not implemented; however, it provides a
					// reliable indicator that the operation was unsupported by the type of the exception that was
					// thrown, so also coerce this back into an UnknownCommand response for end-user code
					if (data.status === 13 && data.value && data.value.class &&
						(data.value.class.indexOf('UnsupportedOperationException') > -1 ||
						data.value.class.indexOf('UnsupportedCommandException') > -1)
					) {
						data.status = 9;
					}

					var statusText = statusCodes[data.status];
					if (statusText) {
						error.name = statusText[0];
						error.message = statusText[1];
					}

					if (data.value && data.value.message) {
						error.message = data.value.message;
					}

					if (data.value && data.value.screen) {
						data.value.screen = new Buffer(data.value.screen, 'base64');
					}

					error.status = data.status;
					error.detail = data.value;
					error.request = {
						url: url,
						method: method,
						data: requestData
					};
					error.response = response;

					// TODO: Possibly remove this extra debugging stuff from the error message
					error.message = '[' + method + ' ' + url +
						(requestData ? ' / ' + JSON.stringify(requestData) : '') +
						'] ' + error.message;

					throw error;
				}

				return data;
			});
		};
	}

	function returnValue(response) {
		return response.value;
	}

	function Server(url) {
		this.url = url.replace(/\/*$/, '/');
	}

	Server.prototype = {
		constructor: Server,

		_get: createHttpRequest('GET'),
		_post: createHttpRequest('POST'),
		_delete: createHttpRequest('DELETE'),

		getStatus: function () {
			return this._get('status');
		},

		createSession: function (desiredCapabilities, requiredCapabilities) {
			var self = this;
			return this._post('session', {
				desiredCapabilities: desiredCapabilities,
				requiredCapabilities: requiredCapabilities
			}).then(function (response) {
				return self._fixSessionCapabilities(new Session(response.sessionId, self, response.value));
			});
		},

		_fixSessionCapabilities: function (session) {
			/*jshint maxlen:140 */
			var capabilities = session.capabilities;
			var testedCapabilities = {};

			function supported() { return true; }
			function unsupported() { return false; }
			function maybeSupported(error) { return error.name !== 'UnknownCommand'; }

			// Appium iOS as of April 2014 supports rotation but does not specify the capability
			if (!('rotatable' in capabilities)) {
				testedCapabilities.rotatable = session.getOrientation().then(supported, unsupported);
			}

			// At least FirefoxDriver 2.40.0 and ios-driver 0.6.0 claim they support geolocation when they do not
			if (capabilities.locationContextEnabled) {
				testedCapabilities.locationContextEnabled = session.getGeolocation()
					.then(supported, function (error) {
						return error.name !== 'UnknownCommand' &&
							error.message.indexOf('not mapped : GET_LOCATION') === -1;
					});
			}

			// At least FirefoxDriver 2.40.0 claims it supports web storage when it does not
			if (capabilities.webStorageEnabled) {
				testedCapabilities.webStorageEnabled = session.getLocalStorageLength()
					.then(supported, maybeSupported);
			}

			// At least FirefoxDriver 2.40.0 claims it supports application cache when it does not
			if (capabilities.applicationCacheEnabled) {
				testedCapabilities.applicationCacheEnabled = session.getApplicationCacheStatus()
					.then(supported, maybeSupported);
			}

			// At least Selendroid 0.9.0 has broken cookie deletion
			testedCapabilities.brokenDeleteCookie = session.setCookie({ name: 'foo', value: 'foo' }).then(function () {
				return session.deleteCookie('foo');
			}).then(function () {
				return session.getCookies();
			}).then(function (cookies) {
				if (cookies.length) {
					return session.clearCookies().then(function () {
						return true;
					});
				}

				return false;
			}).otherwise(function () {
				return true;
			});

			// At least Selendroid 0.9.0 has a bug where it catastrophically fails to retrieve available types;
			// they have tried to hardcode the available log types in this version so we can just return the
			// same hardcoded list ourselves
			testedCapabilities.fixedLogTypes = session.getAvailableLogTypes().then(unsupported, function (error) {
				if (session.capabilities.browserName === 'selendroid' && !error.response.text.length) {
					return [ 'logcat' ];
				}

				return [];
			});

			// Some additional, currently-non-standard capabilities are needed in order to know about supported
			// features of a given platform
			if (!('mouseEnabled' in capabilities)) {
				testedCapabilities.mouseEnabled = session.doubleClick()
					.then(supported, maybeSupported);
			}

			if (!('touchEnabled' in capabilities)) {
				testedCapabilities.touchEnabled = session.longTap()
					.then(supported, maybeSupported);
			}

			if (!('dynamicViewport' in capabilities)) {
				testedCapabilities.dynamicViewport = session.getWindowSize().then(function (originalSize) {
					return session.setWindowSize(originalSize.width, originalSize.height);
				}).then(supported, unsupported);
			}

			// At least ios-driver 0.6.6-SNAPSHOT April 2014 does not support execute_async
			testedCapabilities.supportsExecuteAsync = session.executeAsync('arguments[0](true);').otherwise(unsupported);

			// At least ios-driver 0.6.6-SNAPSHOT April 2014 corrupts its internal state when performing window
			// switches and gets permanently stuck; we cannot feature detect, so platform sniffing it is
			testedCapabilities.brokenWindowSwitch = session.capabilities.browserName === 'Safari' &&
				session.capabilities.platformName === 'IOS';

			return whenAll(testedCapabilities).then(function (testedCapabilities) {
				for (var k in testedCapabilities) {
					capabilities[k] = testedCapabilities[k];
				}
			}).then(function () {
				// Touch scroll in ios-driver 0.6.6-SNAPSHOT is broken, does not scroll at all;
				// in selendroid 0.9.0 it ignores the element argument
				if (capabilities.touchEnabled) {
					var scrollTestUrl = 'data:text/html;charset=utf-8,' +
						encodeURIComponent('<!DOCTYPE html><div id="a" style="margin: 3000px;"></div>');

					return session.get(scrollTestUrl).then(function () {
						return session.touchScroll(0, 20);
					}).then(function () {
						return session.execute('return window.scrollY !== 20;');
					}).then(function (isBroken) {
						if (isBroken) {
							return true;
						}

						return session.getElementById('a').then(function (element) {
							return session.touchScroll(element, 0, 0);
						}).then(function () {
							return session.execute('return window.scrollY !== 3000;');
						});
					}).otherwise(function () {
						return true;
					}).then(function (isBroken) {
						capabilities.brokenTouchScroll = isBroken;
					});
				}
			}).then(function () {
				// At least ios-driver 0.6.6-SNAPSHOT April 2014 will never complete a refresh call
				return session.get('about:blank?1').then(function () {
					var dfd = new Deferred();

					function cleanup() {
						clearTimeout(timer);
						if (!refresh.isFulfilled()) {
							refresh.cancel();
						}
					}

					var refresh = session.refresh().then(function () {
						cleanup();
						dfd.resolve(false);
					}, function () {
						cleanup();
						dfd.resolve(true);
					});

					var timer = setTimeout(function () {
						cleanup();
					}, 2000);

					return dfd.promise;
				}).otherwise(function () {
					return true;
				}).then(function (isBroken) {
					capabilities.brokenRefresh = isBroken;
				});
			}).always(function () {
				console.log(session.capabilities);
				return session.get('about:blank').then(function () {
					return session;
				});
			});
		},

		getSessions: function () {
			return this._get('sessions').then(returnValue);
		},

		getSessionCapabilities: function (sessionId) {
			return this._get('session/$0', null, [ sessionId ]).then(returnValue);
		},

		deleteSession: function (sessionId) {
			return this._delete('session/$0', null, [ sessionId ]).then(returnValue);
		}
	};

	return Server;
});
