define([
	'dojo/Deferred',
	'dojo/lang',
	'dojo/request',
	'./statusCodes',
	'./Session'
], function (Deferred, lang, request, statusCodes, Session) {
	function createHttpRequest(method) {
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
							status: response.status === 404 ? 9 : 13,
							value: {
								message: response.text
							}
						};
					}

					var statusText = statusCodes[data.status];
					if (statusText) {
						error.name = statusText[0];
						error.message = statusText[1];
					}

					if (data.value && data.value.message) {
						error.message = data.value.message;
					}

					error.status = data.status;
					error.detail = data.value;
					error.request = {
						url: url,
						method: method,
						data: requestData
					};

					error.message = '[' + method + ' ' + url + (requestData ? ' / ' + JSON.stringify(requestData) : '') + '] ' + error.message;

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
				return new Session(response.sessionId, self);
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
