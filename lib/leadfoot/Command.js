/**
 * @module leadfoot/Command
 */
define([
	'dojo/promise/all',
	'./strategies',
	'./Session',
	'./Element',
	'./util'
], function (whenAll, strategies, Session, Element, util) {
	/**
	 * Creates a function that, when called, creates a new Command that retrieves elements from the parent context and
	 * uses them as the context for the newly created Command.
	 *
	 * @param {string} method
	 * @returns {Function}
	 */
	function createElementMethod(method) {
		return function () {
			var args = arguments;
			return new Command(this, function (setContext) {
				var parentContext = this._context;
				var promise;

				if (parentContext.length && parentContext.isSingle) {
					promise = parentContext[0][method].apply(parentContext[0], args);
				}
				else if (parentContext.length) {
					promise = whenAll(parentContext.map(function (element) {
						return element[method].apply(element, args);
					})).then(function (elements) {
						// getElements against an array context will result in arrays of arrays; flatten into a single
						// array of elements. It would also be possible to resort in document order but other parallel
						// operations could not be sorted so we just don't do it anywhere and say not to rely in
						// a particular return order for results
						return Array.prototype.concat.apply([], elements);
					});
				}
				else {
					promise = this.session[method].apply(this.session, args);
				}

				return promise.then(function (newContext) {
					setContext(newContext);
					return newContext;
				});
			});
		};
	}

	/**
	 * A Command is a chainable object that can be used to execute commands serially against a remote environment using
	 * a fluid interface.
	 *
	 * @constructor module:leadfoot/Command
	 * @param {module:leadfoot/Command|module:leadfoot/Session} parent
	 * @param {Function} initialiser
	 * A function that returns a Promise that resolves to zero or more Elements to be used as the context for the
	 * command.
	 */
	function Command(parent, callback, errback) {
		var self = this;

		function setContext(context) {
			if (!Array.isArray(context)) {
				context = [ context ];
				context.isSingle = true;
			}

			self._context = context;
		}

		if (parent.session) {
			this._parent = parent;
			this._session = parent.session;
		}
		else if (parent.sessionId) {
			this._session = parent;
			parent = null;
		}
		else {
			throw new Error('A parent Command or Session must be provided to a new Command');
		}

		this._promise = (parent ? parent.promise : util.createPromise(undefined)).then(function (returnValue) {
			self._context = parent ? parent.context : [];
			return returnValue;
		}).then(
			callback && callback.bind(this, setContext),
			errback && errback.bind(this, setContext)
		);
	}

	Command.prototype = /** @lends module:leadfoot/Command# */ {
		constructor: Command,

		/**
		 * The parent Command of the command, if one exists.
		 *
		 * @member {module:leadfoot/Command=} parent
		 * @memberOf module:leadfoot/Command#
		 * @readonly
		 */
		get parent() {
			return this._parent;
		},

		/**
		 * The parent Session of the command.
		 *
		 * @member {module:leadfoot/Session} session
		 * @memberOf module:leadfoot/Command#
		 * @readonly
		 */
		get session() {
			return this._session;
		},

		get context() {
			return this._context;
		},

		get promise() {
			return this._promise;
		},

		/**
		 * Pauses execution of the next command in the chain for `ms` milliseconds.
		 *
		 * @param {number} ms Time to delay, in milliseconds.
		 * @returns {module:leadfoot/Command.<void>}
		 */
		sleep: function (ms) {
			return new Command(this, function () {
				return util.sleep(ms);
			});
		},

		/**
		 * Ends the most recent filtering operation in the current Command chain and returns the most recent Command
		 * with a different element match state.
		 *
		 * @param {number=} numCommandsToPop The number of element contexts to pop. Defaults to 1.
		 * @returns {module:leadfoot/Command.<void>}
		 */
		end: function (numCommandsToPop) {
			return new Command(this, function (setContext) {
				if (!numCommandsToPop) {
					numCommandsToPop = 1;
				}

				var command = this;

				do {
					command = command.parent;

					if (!command.parent) {
						break;
					}

					if (command.context !== command.parent.context) {
						--numCommandsToPop;
					}
				}
				while (numCommandsToPop);

				setContext(command.context);
			});
		},

		/**
		 * Adds a callback to be invoked once the previously chained operation has completed. Command callbacks
		 * receive a second non-standard argument, `setContext`, which allows callbacks to create new contexts for
		 * subsequent chained commands.
		 *
		 * @param {Function=} callback
		 * @param {Function=} errback
		 * @returns {module:leadfoot/Command.<any>}
		 */
		then: function (callback, errback) {
			return new Command(this, callback && function (setContext, value) {
				return callback.call(this, value, setContext);
			}, errback && function (setContext, value) {
				return errback.call(this, value, setContext);
			});
		},

		/**
		 * Adds a callback to be invoked when any of the previously chained operations have failed.
		 *
		 * @param {Function} errback
		 * @returns {module:leadfoot/Command.<any>}
		 */
		otherwise: function (errback) {
			return this.then(null, errback);
		},

		/**
		 * Adds a callback to be invoked once the previously chained operations have resolved.
		 *
		 * @param {Function} callback
		 * @returns {module:leadfoot/Command.<any>}
		 */
		always: function (callback) {
			return this.then(callback, callback);
		},

		/**
		 * Cancels all outstanding chained operations of the Command. Calling this method will cause all chained
		 * operations to fail with a CancelError.
		 *
		 * @returns {module:leadfoot/Command.<void>}
		 */
		cancel: function () {
			this._promise.cancel.apply(this._promise, arguments);
			return this;
		},

		getElement: createElementMethod('getElement'),
		getElements: createElementMethod('getElements')
	};

	// Element retrieval strategies must be applied directly to Command because it has its own custom
	// getElement/getElements methods that operate based on the Command’s context, so can’t simply be delegated to the
	// underlying session
	strategies.applyTo(Command.prototype);

	Object.keys(Session.prototype).forEach(function (key) {
		if (key.charAt(0) !== '_' && !Command.prototype[key] && typeof Session.prototype[key] === 'function') {
			Command.prototype[key] = function () {
				var fn = this[key];
				var args = arguments;

				return new Command(this, function (setContext) {
					var parentContext = this._context;
					var session = this._session;

					if (fn.usesElement && parentContext.length && (!args[0] || !args[0].elementId)) {
						var promise;
						args = Array.prototype.slice.call(arguments, 0);

						if (parentContext.isSingle) {
							promise = fn.apply(session, [ parentContext[0] ].concat(args));
						}
						else {
							promise = whenAll(parentContext.map(function (element) {
								return fn.apply(session, [ element ].concat(args));
							}));
						}
					}
					else {
						promise = fn.apply(session, args);
					}

					if (fn.createsContext) {
						promise = promise.then(function (newContext) {
							setContext(newContext);
							return newContext;
						});
					}

					return promise;
				});
			};
		}
	});

	Object.keys(Element.prototype).forEach(function (key) {
		if (key.charAt(0) !== '_' && typeof Element.prototype[key] === 'function') {
			// some methods, like `click`, exist on both Session and Element; deduplicate these methods by appending the
			// element ones with 'Element'
			var targetKey = key + (Command.prototype[key] ? 'Element' : '');
			Command.prototype[targetKey] = function () {
				var args = arguments;
				return new Command(this, function (setContext) {
					var parentContext = this._context;
					var promise;
					var fn = parentContext[0] && parentContext[0][key];

					if (parentContext.isSingle) {
						promise = fn.apply(parentContext[0], args);
					}
					else {
						promise = whenAll(parentContext.map(function (element) {
							return element[key].apply(element, args);
						}));
					}

					if (fn && fn.createsContext) {
						promise = promise.then(function (newContext) {
							setContext(newContext);
							return newContext;
						});
					}

					return promise;
				});
			};
		}
	});

	try {
		var chaiAsPromised = require.nodeRequire('chai-as-promised');
	}
	catch (error) {}

	if (chaiAsPromised) {
		chaiAsPromised.transferPromiseness = function (assertion, promise) {
			assertion.then = promise.then.bind(promise);
			Object.keys(Command.prototype).forEach(function (method) {
				if (typeof promise[method] === 'function') {
					assertion[method] = promise[method].bind(promise);
				}
			});
		};
	}

	return Command;
});
