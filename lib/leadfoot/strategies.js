define([
	'dojo/lang',
	'dojo/Deferred',
	'./statusCodes'
], function (lang, Deferred, statusCodes) {
	var STRATEGIES = [
		'class name',
		'css selector',
		'id',
		'name',
		'link text',
		'partial link text',
		'tag name',
		'xpath'
	];

	var SUFFIXES = STRATEGIES.map(function (strategy) {
		return strategy.replace(/(?:^| )([a-z])/, function (_, letter) {
			return letter.toUpperCase();
		});
	});

	return {
		suffixes: SUFFIXES,
		applyTo: function (prototype) {
			STRATEGIES.forEach(function (strategy, index) {
				var suffix = SUFFIXES[index];

				prototype['getElementBy' + suffix] = function (value) {
					return this.getElement(strategy, value);
				};

				prototype['waitForDeletedElementBy' + suffix] = function (value) {
					var self = this;
					var session = self.session || self;
					var originalTimeout;

					return session.getTimeout('implicit').then(function (value) {
						originalTimeout = value;
						return session.setTimeout('implicit', 0);
					}).then(function () {
						var dfd = new Deferred();
						var startTime = Date.now();

						(function poll() {
							if (Date.now() - startTime > originalTimeout) {
								session.setTimeout('implicit', originalTimeout).always(function () {
									var error = new Error();
									error.status = 21;
									error.name = statusCodes[error.status][0];
									error.message = statusCodes[error.status][1];
									dfd.reject(error);
								});
								return;
							}

							self['getElementBy' + suffix](value).then(poll, function (error) {
								session.setTimeout('implicit', originalTimeout).always(function () {
									if (error.name === 'NoSuchElement') {
										dfd.resolve();
									}
									else {
										dfd.reject(error);
									}
								});
							});
						})();

						return dfd.promise;
					});
				};

				if (strategy !== 'id') {
					prototype['getElementsBy' + suffix] = function (value) {
						return this.getElements(strategy, value);
					};
				}
			});
		}
	};
});
