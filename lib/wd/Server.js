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

			return request(url, {
				data: JSON.stringify(requestData),
				handleAs: 'text',
				headers: {
					'Content-Type': 'application/json;charset=UTF-8'
				},
				method: method
			}).response.always(function (response) {
				var responseType = response.getHeader('Content-Type');
				var data;

				if (responseType && responseType.indexOf('application/json') === 0 && response.text) {
					data = JSON.parse(response.text);
				}

				if (response.status >= 400 || (data && data.status > 0)) {
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

					error.detail = data.value;
					error.request = {
						url: url,
						method: method,
						data: requestData
					};

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
