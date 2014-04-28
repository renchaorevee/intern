define([
	'intern!object',
	'intern/chai!assert',
	'intern/main',
	'./support/util',
	'../../../lib/Session'
], function (registerSuite, assert, intern, util, Session) {
	// TODO: Figure out the best way to execute this test
	registerSuite(function () {
		var server;

		return {
			name: 'lib/leadfoot/Server',

			setup: function () {
				server = util.createServer(intern.config.webdriver);
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

			'session handling': (function () {
				var desiredCapabilities = {
					browserName: 'firefox'
				};
				var session;

				return {
					setup: function () {
						return server.createSession(desiredCapabilities).then(function (result) {
							session = result;
						});
					},

					'#getSessions': function () {
						return server.getSessions().then(function (result) {
							assert.isArray(result);
							assert.lengthOf(result, 1, 'Server should return a list containing all open sessions');
							assert.strictEqual(result[0].id, session.sessionId);
							assert.isObject(result[0].capabilities);
							assert.strictEqual(result[0].capabilities.browserName, desiredCapabilities.browserName);
						}, function (error) {
							// Sauce OnDemand as of March 2014 does not support listing open sessions; just ignore it
							if (error.name === 'UnknownCommand') {
								return server.getStatus().then(function (result) {
									if (result.value.build && result.value.build.version === 'Sauce OnDemand') {
										return;
									}

									throw error;
								});
							}

							throw error;
						});
					},

					'#getSessionCapabilities': function () {
						return server.getSessionCapabilities(session.sessionId).then(function (capabilities) {
							assert.isObject(capabilities);
							assert.strictEqual(
								capabilities.browserName,
								desiredCapabilities.browserName,
								'Returned browser should be requested browser'
							);
							assert.deepEqual(capabilities, session.capabilities);
						});
					},

					teardown: function () {
						return server.deleteSession(session.sessionId);
					}
				};
			})(),

			'.sessionConstructor': (function () {
				function CustomSession() {
					Session.apply(this, arguments);
				}
				CustomSession.prototype = Object.create(Session.prototype);
				CustomSession.prototype.constructor = CustomSession;
				CustomSession.prototype.isCustomSession = true;

				var desiredCapabilities = {
					browserName: 'firefox'
				};

				return {
					setup: function () {
						server.sessionConstructor = CustomSession;
					},

					'': function () {
						return server.createSession(desiredCapabilities).then(function (session) {
							assert.isTrue(session.isCustomSession);
						});
					},

					teardown: function () {
						server.sessionConstructor = Session;
					}
				};
			})()
		};
	});
});
