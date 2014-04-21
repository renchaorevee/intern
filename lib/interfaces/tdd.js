define([
	'dojo/aspect',
	'../../main',
	'../Suite',
	'../Test'
], function (aspect, main, Suite, Test) {
	var currentSuite,
		suites = [];

	function registerSuite(name, factory) {
		var parentSuite = currentSuite;

		currentSuite = new Suite({ name: name, parent: parentSuite });

		suites.push(parentSuite);
		factory();

		if (currentSuite.tests.length > 0) {
			parentSuite.tests.push(currentSuite);
		}

		currentSuite = suites.pop();
	}

	return {
		suite: function (name, factory) {
			if (/* is a root suite */ !currentSuite) {
				main.suites.forEach(function (suite) {
					currentSuite = suite;
					registerSuite(name, factory);
					currentSuite = null;
				});
			}
			else {
				registerSuite(name, factory);
			}
		},

		test: function (name, test) {
			var t = new Test({ name: name, test: test, parent: currentSuite });
			main.grep(t) && currentSuite.tests.push(t);
		},

		before: function (fn) {
			aspect.after(currentSuite, 'setup', fn);
		},

		after: function (fn) {
			aspect.after(currentSuite, 'teardown', fn);
		},

		beforeEach: function (fn) {
			aspect.after(currentSuite, 'beforeEach', fn);
		},

		afterEach: function (fn) {
			aspect.after(currentSuite, 'afterEach', fn);
		}
	};
});
