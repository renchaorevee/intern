define([
	'intern!object',
	'intern/chai!assert',
	'dojo/promise/all',
	'./support/util',
	'../../../lib/leadfoot/strategies',
	'../../../lib/leadfoot/Element',
	'require'
], function (registerSuite, assert, whenAll, util, strategies, Element, require) {
	registerSuite(function () {
		var session;

		return {
			name: 'lib/leadfoot/Element',

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

			'#toJSON': function () {
				var element = new Element('1');
				assert.deepEqual(element.toJSON(), { ELEMENT: '1' });
			}
		};
	});
});
