/*jshint node:true */
define([ './selftest.intern' ], function (config) {
	config.webdriver.username = process.env.SAUCE_USERNAME;
	config.webdriver.accessKey = process.env.SAUCE_ACCESS_KEY;
	config.suites.push('intern-selftest/tests/lib/leadfoot/Server');
	return config;
});
