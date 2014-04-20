/**
 * Common utility methods.
 * @module leadfoot/util
 */
define([ 'exports', 'dojo/Deferred' ], function (exports, Deferred) {
	/**
	 * Creates a promise that resolves itself after `ms` milliseconds.
	 *
	 * @param {number} ms Time until resolution in milliseconds.
	 * @returns {Promise.<void>}
	 */
	exports.sleep = function (ms) {
		var dfd = new Deferred();
		setTimeout(function () {
			dfd.resolve();
		}, ms);
		return dfd.promise;
	};

	/**
	 * Creates a promise pre-resolved to `value`.
	 *
	 * @param {any} value The pre-resolved value.
	 * @returns {Promise.<any>}
	 */
	exports.createPromise = function (value) {
		var dfd = new Deferred();
		dfd.resolve(value);
		return dfd.promise;
	};
});
