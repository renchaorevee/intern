define([
	'intern!object',
	'intern/chai!assert',
	'dojo/promise/all',
	'./support/util',
	'../../../lib/leadfoot/strategies',
	'../../../lib/leadfoot/Command',
	'require'
], function (registerSuite, assert, whenAll, util, strategies, Command, require) {
	/*jshint maxlen:140 */
	registerSuite(function () {
		var session;

		return {
			name: 'lib/leadfoot/Command',
			setup: function () {
				return util.createSessionFromRemote(this.remote).then(function () {
					session = arguments[0];
				});
			},

			beforeEach: function () {
				return session.get('about:blank').then(function () {
					return session.setTimeout('implicit', 0);
				});
			},

			'basic functionality': function () {
				var command = new Command(session, null, function () {
					return util.createPromise('a');
				});

				return command.then(function (returnValue) {
					assert.strictEqual(this, command, 'The `this` object in callbacks should be the Command object');
					assert.deepEqual(command.context, [ 'a' ], 'The context of the Command should be set by the initialiser');
					assert.isUndefined(returnValue, 'The return value of the initialiser should not be exposed to the first callback');
				});
			},

			'chain': function () {
				var command = new Command(session);
				return command.get(require.toUrl('./data/default.html'))
					.getPageTitle()
					.then(function (pageTitle) {
						assert.strictEqual(pageTitle, 'Default & <b>default</b>');
					});
			}
		};
	});
});
