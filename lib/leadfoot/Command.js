/**
 * @module leadfoot/Command
 */
define([
	'dojo/Deferred',
	'dojo/promise/all',
	'./strategies',
	'./Session',
	'./Element',
	'./util'
], function (Deferred, whenAll, strategies, Session, Element, util) {
	/**
	 * Creates a new function that invokes `handler` as the next callback once the current asynchronous action resolves,
	 * passing in the arguments from the original call to be used by the handler.
	 *
	 * @param {Function} handler
	 * @returns {Function}
	 */
	function createDelegateMethod(handler) {
		return function () {
			var args = Array.prototype.slice.call(arguments, 0);
			this._lastPromise = this._lastPromise.then(handler.bind(this, args));
			return this;
		};
	}

	/**
	 * Creates a method that, when called, creates a new Command object, using `method` from the current session as
	 * the initialiser for the new child Command instance.
	 *
	 * @param {string} method
	 * @returns {Function}
	 */
	function createElementMethod(method) {
		return function () {
			var parent = this;
			var args = arguments;
			var context = this._context;
			var session = this._session;

			return new Command(session, this, function () {
				var newContext;
				// TODO: Actually, this might make no sense in the morning and we just need to flatten the returned
				// array from line 42
				if (context.length && parent._isSingleElementContext) {
					newContext = context[0][method].apply(context[0], args);
				}
				else if (context.length) {
					newContext = whenAll(context.map(function (element) {
						return element[method].apply(element, args);
					})).then(function (elements) {
						return Array.prototype.concat.apply([], elements);
					});
				}
				else {
					newContext = session[method].apply(session, args);
				}

				return newContext;
			});
		};
	}

	/**
	 * Creates a method that allows users to specify that a call to `execute` will be returning elements and should be
	 * used as an initialiser for a new child Command instance.
	 *
	 * @param {string} method
	 * @returns {Function}
	 */
	function createExecuteMethod(method) {
		return function (code, args, asNewCommand) {
			var session = this._session;
			function execute() {
				return session[method](code, args);
			}

			if (asNewCommand) {
				return new Command(session, this, execute);
			}

			this._lastPromise = this._lastPromise.then(execute);

			return this;
		};
	}

	/**
	 * A Command is a chainable object that can be used to execute commands serially against a remote environment using
	 * a fluid interface.
	 *
	 * @constructor module:leadfoot/Command
	 * @param {module:leadfoot/Session} session
	 * @param {module:leadfoot/Command=} parent
	 * @param {(function(): Promise.<(module:leadfoot/Element|Array.<module:leadfoot/Element>)>)=} initialiser
	 * A function that returns a Promise that resolves to zero or more Elements to be used as the context for the
	 * command.
	 */
	function Command(session, parent, initialiser) {
		this._session = session;
		this._parent = parent;
		this._context = [];
		this._isSingleElementContext = true;
		this._hasInitialiser = false;

		if (initialiser) {
			var self = this;
			var context = this._context;
			var promise = parent ? parent.then(initialiser.bind(this)) : initialiser.call(this);
			this._hasInitialiser = true;
			this._lastPromise = promise.then(function (newContext) {
				if (Array.isArray(newContext)) {
					self._isSingleElementContext = false;
					context.push.apply(context, newContext);
				}
				else {
					context.push(newContext);
				}

				return newContext;
			});
		}
		else {
			this._lastPromise = util.createPromise(undefined);
		}
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

		/**
		 * The context Elements for the current command, if they exist.
		 *
		 * @member {Array.<module:leadfoot/Element>} context
		 * @memberOf module:leadfoot/Command#
		 * @readonly
		 */
		get context() {
			return this._context;
		},

		/**
		 * Gets the first element within each context element that matches the given query.
		 *
		 * @method
		 * @see {@link module:leadfoot/Command#setImplicitTimeout} to set the amount of time it the remote environment
		 * should spend waiting for an element that does not exist at the time of the `getElement` call before timing
		 * out.
		 *
		 * @param {string} using
		 * The element retrieval strategy to use. See {@link module:leadfoot/Session#getElement} for options.
		 *
		 * @param {string} value
		 * The strategy-specific value to search for. See {@link module:leadfoot/Session#getElement} for details.
		 *
		 * @returns {module:leadfoot/Command.<module:leadfoot/Element>}
		 */
		getElement: createElementMethod('getElement'),

		/**
		 * Gets all elements within each context element that match the given query.
		 *
		 * @method
		 * @param {string} using
		 * The element retrieval strategy to use. See {@link module:leadfoot/Session#getElement} for options.
		 *
		 * @param {string} value
		 * The strategy-specific value to search for. See {@link module:leadfoot/Session#getElement} for details.
		 *
		 * @returns {module:leadfoot/Command.<Array.<module:leadfoot/Element>>}
		 */
		getElements: createElementMethod('getElements'),

		/**
		 * Gets the currently focused element from the focused window/frame.
		 *
		 * @returns {module:leadfoot/Command.<module:leadfoot/Element>}
		 */
		getActiveElement: function () {
			var session = this._session;
			return new Command(session, this, function () {
				return session.getActiveElement();
			});
		},

		/**
		 * Executes JavaScript code within the focused window/frame. The code should return a value synchronously.
		 *
		 * @method
		 * @see {@link module:leadfoot/Session#executeAsync} to execute code that returns values asynchronously.
		 *
		 * @param {Function|string} script
		 * The code to execute. If a string value is passed, it will be converted to a function on the remote end.
		 *
		 * @param {any[]} args
		 * An array of arguments that will be passed to the executed code.
		 *
		 * @param {boolean=} asNewCommand
		 * If true, a new Command will be returned for this execute call. This should be done if the executed code
		 * returns a new element or array of elements that you want to chain against.
		 *
		 * @returns {module:leadfoot/Command.<any>}
		 * The value returned by the remote code. Only values that can be serialised to JSON, plus DOM elements, can be
		 * returned.
		 */
		execute: createExecuteMethod('execute'),

		/**
		 * Executes JavaScript code within the focused window/frame. The code must invoke the provided callback in
		 * order to signal that it has completed execution.
		 *
		 * @method
		 * @see {@link module:leadfoot/Session#execute} to execute code that returns values synchronously.
		 * @see {@link module:leadfoot/Session#setExecuteAsyncTimeout} to set the time until an asynchronous script is
		 * considered timed out.
		 *
		 * @param {Function|string} script
		 * The code to execute. If a string value is passed, it will be converted to a function on the remote end.
		 *
		 * @param {any[]} args
		 * An array of arguments that will be passed to the executed code. In addition to these arguments, a callback
		 * function will always be passed as the final argument to the script. This callback function must be invoked
		 * in order to signal that execution has completed. The return value of the script, if any, should be passed to
		 * this callback function.
		 *
		 * @param {boolean=} asNewCommand
		 * If true, a new Command will be returned for this execute call. This should be done if the executed code
		 * returns a new element or array of elements that you want to chain against.
		 *
		 * @returns {module:leadfoot/Command.<any>}
		 * The value returned by the remote code. Only values that can be serialised to JSON, plus DOM elements, can be
		 * returned.
		 */
		executeAsync: createExecuteMethod('executeAsync'),

		/**
		 * Pauses execution of the next command in the chain for `ms` milliseconds.
		 *
		 * @param {number} ms Time to delay, in milliseconds.
		 * @returns {module:leadfoot/Command.<void>}
		 */
		sleep: function (ms) {
			this._lastPromise = this._lastPromise.then(function () {
				return util.sleep(ms);
			});

			return this;
		},

		/**
		 * Ends the most recent filtering operation in the current chain and returns the set of matched elements to its
		 * previous state.
		 *
		 * @param {number=} numCommandsToPop The number of element contexts to pop. Defaults to 1.
		 * @returns {module:leadfoot/Command.<void>}
		 */
		end: function (numCommandsToPop) {
			if (!numCommandsToPop) {
				numCommandsToPop = 1;
			}

			var command = this;
			while (numCommandsToPop--) {
				if (!command._parent) {
					break;
				}

				command = command._parent;
			}

			return command;
		},

		/**
		 * Adds a callback to be invoked once the previously chained operation has completed.
		 *
		 * @param {Function} callback
		 * @param {Function=} errback
		 * @returns {module:leadfoot/Command.<any>}
		 */
		then: function (callback, errback) {
			var self = this;
			var dfd = new Deferred();

			function fixCallback(callback) {
				// `null`
				if (typeof callback !== 'function') {
					return callback;
				}

				return function () {
					self._lastPromise = util.createPromise(undefined);

					try {
						var returnValue = callback.apply(self, arguments);

						if (returnValue && returnValue.then) {
							returnValue.then(dfd.resolve.bind(dfd), dfd.reject.bind(dfd));
						}
						else {
							dfd.resolve(returnValue);
						}
					}
					catch (error) {
						dfd.reject(error);
					}

					return dfd.promise;
				};
			}

			this._lastPromise = this._lastPromise.then(fixCallback(callback), fixCallback(errback));

			return this;
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
			this._lastPromise && this._lastPromise.cancel.apply(this._lastPromise, arguments);
			return this;
		},

		/**
		 * Resets the state of the Command.
		 *
		 * @returns {module:leadfoot/Command.<void>}
		 */
		reset: function () {
			this.cancel();
			this._lastPromise = this._hasInitialiser ?
				util.createPromise(this._isSingleElementContext ? this._context[0] : this._context.slice(0)) :
				util.createPromise(undefined);
			return this;
		}
	};

	// Element retrieval strategies must be applied directly to Command because it has its own custom
	// getElement/getElements methods that generate new Commands, so can’t simply be delegated to the underlying session
	strategies.applyTo(Command.prototype);

	Object.keys(Session.prototype).forEach(function (key) {
		if (key.charAt(0) !== '_' && !Command.prototype[key] && typeof Session.prototype[key] === 'function') {
			Command.prototype[key] = createDelegateMethod(function (args) {
				var session = this._session;
				var context = this._context;
				var fn = session[key];

				if (fn.usesElement && context.length) {
					if (this._isSingleElementContext) {
						return fn.apply(session, [ context[0] ].concat(args));
					}
					else {
						return whenAll(context.map(function (element) {
							return fn.apply(session, [ element ].concat(args));
						}));
					}
				}

				return fn.apply(session, args);
			});
		}
	});

	Object.keys(Element.prototype).forEach(function (key) {
		if (key.charAt(0) !== '_' && typeof Element.prototype[key] === 'function') {
			// some methods, like `click`, exist on both Session and Element; deduplicate these methods by appending the
			// element ones with 'Element'
			var targetKey = key + (Command.prototype[key] ? 'Element' : '');
			Command.prototype[targetKey] = createDelegateMethod(function (args) {
				var context = this._context;
				if (this._isSingleElementContext) {
					return context[0][key].apply(context[0], args);
				}
				else {
					return whenAll(context.map(function (element) {
						return element[key].apply(element, args);
					}));
				}
			});
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
