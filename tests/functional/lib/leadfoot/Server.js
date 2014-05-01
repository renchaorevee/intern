define([
	'intern!object',
	'intern/chai!assert',
	'intern/main',
	'./support/util'
], function (registerSuite, assert, intern, util) {
	registerSuite(function () {
		var server;

		return {
			name: 'lib/leadfoot/Server',

			setup: function () {
				server = util.createServerFromRemote(this.remote);
			},

			'error handling': function () {
				return server._get('invalidCommand').then(function () {
					throw new Error('Request to invalid command should not be successful');
				}, function (error) {
					assert.strictEqual(error.name, 'UnknownCommand', 'Unknown command should throw error');
				});
			},

			'#getStatus': function () {
				return server.getStatus().then(function (result) {
					assert.isObject(result, 'Server should provide an object with details about the server');
				});
			},

			'#getSessions': function () {
				var currentSession = this.remote.session;
				return server.getSessions().then(function (result) {
					assert.isArray(result);
					assert.operator(result.length, '>=', 1);
					assert.isTrue(result.some(function (session) {
						return currentSession.sessionId === session.id;
					}));
				});
			},

			'#getSessionCapabilities': function () {
				var session = this.remote.session;
				return server.getSessionCapabilities(session.sessionId).then(function (capabilities) {
					assert.isObject(capabilities);
					assert.strictEqual(capabilities.browserName, session.capabilities.browserName);
					assert.strictEqual(capabilities.version, session.capabilities.version);
					assert.strictEqual(capabilities.platform, session.capabilities.platform);
					assert.strictEqual(capabilities.platformVersion, session.capabilities.platformVersion);
				});
			},

			'.sessionConstructor': (function () {
				function CustomSession() {}
				var oldCtor;
				var oldPost;
				var mockCapabilities = {
					isMockCapabilities: true
				};

				return {
					setup: function () {
						oldCtor = server.sessionConstructor;
						oldPost = server._post;
						server.sessionConstructor = CustomSession;
						server.fixSessionCapabilities = false;
						server._post = function () {
							return util.createPromise(mockCapabilities);
						};
					},

					'': function () {
						return server.createSession({}).then(function (session) {
							assert.instanceOf(session, CustomSession);
							assert.isTrue(session.capabilities.isMockCapabilities);
						});
					},

					teardown: function () {
						server.sessionConstructor = oldCtor;
						server.fixSessionCapabilities = true;
						server._post = oldPost;
					}
				};
			})()
		};
	});
});
