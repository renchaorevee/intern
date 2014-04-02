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
				return pathParts[index];
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
			var capabilities = session.capabilities;
			var testedCapabilities = {};

			function supported() { return true; }
			function unsupported() { return false; }
			function maybeSupported(error) { return error.name !== 'UnknownCommand'; }

			// Appium iOS as of April 2014 supports rotation but does not specify the capability
			if (!('rotatable' in capabilities)) {
				testedCapabilities.rotatable = session.getOrientation().then(supported, unsupported);
			}

			if (capabilities.browserName === 'firefox') {
				// FirefoxDriver 2.40.0 claims it supports geolocation when it does not
				if (capabilities.locationContextEnabled) {
					testedCapabilities.locationContextEnabled = session.getGeolocation()
						.then(supported, maybeSupported);
				}

				// FirefoxDriver 2.40.0 claims it supports web storage when it does not
				if (capabilities.webStorageEnabled) {
					testedCapabilities.webStorageEnabled = session.getLocalStorageLength()
						.then(supported, maybeSupported);
				}

				// FirefoxDriver 2.40.0 claims it supports application cache when it does not
				if (capabilities.applicationCacheEnabled) {
					testedCapabilities.applicationCacheEnabled = session.getApplicationCacheStatus()
						.then(supported, maybeSupported);
				}
			}

			// Some additional, currently-non-standard capabilities are needed in order to know about supported
			// features of a given platform
			// TODO: Maybe these tests should only be performed exclusively for the self-tests
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

			return whenAll(testedCapabilities).then(function (testedCapabilities) {
				console.log(capabilities, testedCapabilities);
				for (var k in testedCapabilities) {
					capabilities[k] = testedCapabilities[k];
				}

				return session;
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
