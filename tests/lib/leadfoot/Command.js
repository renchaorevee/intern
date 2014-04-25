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

			'initialisation': function () {
				var dfd = this.async();
				var parent = new Command(session, function (setContext) {
					setContext('foo');
					return util.createPromise('bar');
				});

				var expectedContext = [ 'foo' ];
				expectedContext.isSingle = true;

				var command = parent.then(function (returnValue) {
					var self = this;
					// setTimeout is necessary because underlying Promise implementation resolves same-turn and so
					// `command` is still not defined when this callback executes
					setTimeout(dfd.callback(function () {
						assert.strictEqual(self, command, 'The `this` object in callbacks should be the Command object');
						assert.deepEqual(command.context, expectedContext, 'The context of the Command should be set by the initialiser');
						assert.deepEqual(returnValue, 'bar', 'The return value of the initialiser should be exposed to the first callback');
					}), 0);
				});

				return dfd.promise;
			},

			'error handling': function () {
				return new Command(session, function () {
					throw new Error('broken');
				}).then(function () {
					throw new Error('Error thrown in initialiser should reject the Command');
				}, function (error) {
					assert.strictEqual(error.message, 'broken');
					error.message += ' 2';
					throw error;
				}).then(function () {
					throw new Error('Error thrown in parent Command should reject child Command');
				}, function (error) {
					assert.strictEqual(error.message, 'broken 2');
				});
			},

			'child command': function () {
				var parent = new Command(session).get(require.toUrl('./data/default.html'));
				var child = parent.getElementByTagName('p');

				return child.then(function (element) {
						assert.notStrictEqual(child, parent, 'Getting an element should cause a new Command to be created');
						assert.isObject(element, 'Element should be provided to first callback of new Command');
					}).getTagName()
					.then(function (tagName) {
						assert.strictEqual(tagName, 'p', 'Tag name of context element should be provided');
					});
			},

			'chain': function () {
				var command = new Command(session);
				return command.get(require.toUrl('./data/default.html'))
					.getPageTitle()
					.then(function (pageTitle) {
						assert.strictEqual(pageTitle, 'Default & <b>default</b>');
					})
					.get(require.toUrl('./data/form.html'))
					.getPageTitle()
					.then(function (pageTitle) {
						assert.strictEqual(pageTitle, 'Form');
					});
			},

			'keys': function () {
				var command = new Command(session);
				return command.get(require.toUrl('./data/form.html'))
					.getElementById('input')
						.clickElement()
						.type('hello')
						.getAttribute('value')
						.then(function (value) {
							assert.strictEqual(value, 'hello', 'Typing into a form field should put data in the field');
						});
			},

			'#getElements': function () {
				return new Command(session).get(require.toUrl('./data/elements.html'))
					.getElementsByClassName('b')
					.getAttribute('id')
					.then(function (ids) {
						assert.deepEqual(ids, [ 'b2', 'b1', 'b3', 'b4' ]);
					});
			},

			'#getElements chain': function () {
				return new Command(session).get(require.toUrl('./data/elements.html'))
					.getElementById('c')
						.getElementsByClassName('b')
							.getAttribute('id')
							.then(function (ids) {
								assert.deepEqual(ids, [ 'b3', 'b4' ]);
							})
							.getElementsByClassName('a')
								.then(function (elements) {
									assert.lengthOf(elements, 0);
								})
							.end()
						.end()
					.end()
					.getElementsByClassName('b')
						.getAttribute('id')
						.then(function (ids) {
							assert.deepEqual(ids, [ 'b2', 'b1', 'b3', 'b4' ]);
						});
			},

			'#getElements + #getElements': function () {
				return new Command(session).get(require.toUrl('./data/elements.html'))
					.getElementsByTagName('div')
						.getElementsByCssSelector('span, a')
							.getAttribute('id')
							.then(function (ids) {
								assert.deepEqual(ids, [ 'f', 'g', 'j', 'i1', 'k', 'zz' ]);
							});
			},

			'creates context': function () {
				var inputElement;
				return new Command(session).get(require.toUrl('./data/form.html'))
					.getElementByTagName('input')
						.then(function () {
							inputElement = this.context[0];
						})
						.click()
						.end()
					.getActiveElement()
						.then(function () {
							return inputElement.equals(this.context[0]);
						})
						.then(function (isEqual) {
							assert.isTrue(isEqual);
						});
			}
		};
	});
});
