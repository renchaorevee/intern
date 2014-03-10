define([], function () {
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

				if (strategy !== 'id') {
					prototype['getElementsBy' + suffix] = function (value) {
						return this.getElements(strategy, value);
					};
				}
			});
		}
	};
});
