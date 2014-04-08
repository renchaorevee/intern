define([ 'dojo/Deferred' ], function (Deferred) {
	return {
		sleep: function (ms) {
			var dfd = new Deferred();
			setTimeout(function () {
				dfd.resolve();
			}, ms);
			return dfd.promise;
		}
	};
});
