define([ 'dojo/topic', './Session' ], function (topic, Session) {
	function getCoverageData() {
		/*global __internCoverage:false */
		return typeof __internCoverage !== 'undefined' && JSON.stringify(__internCoverage);
	}

	function publishCoverageData(coverageData) {
		coverageData && topic.publish('/coverage', this.sessionId, JSON.parse(coverageData));
	}

	function ProxiedSession() {
		Session.apply(this, arguments);
	}

	ProxiedSession.prototype = new Session();
	ProxiedSession.prototype.constructor = ProxiedSession;
	ProxiedSession.prototype.proxyUrl = '';
	ProxiedSession.prototype.proxyBasePathLength = 0;
	ProxiedSession.prototype._heartbeatIntervalHandle = null;

	ProxiedSession.prototype.setUrl = function () {
		var self = this,
			args = arguments;

		if (!/^https?:/.test(args[0])) {
			args[0] = this.proxyUrl + args[0].slice(this.proxyBasePathLength);
		}

		return this.execute(getCoverageData)
			.then(publishCoverageData.bind(this))
			.then(function () {
				return Session.prototype.setUrl.apply(self, args);
			});
	};

	ProxiedSession.prototype.quit = function () {
		var self = this;
		return this.execute(getCoverageData)
			.then(publishCoverageData.bind(this))
			.then(function () {
				return Session.prototype.quit.call(self);
			});
	};

	/**
	 * Sends a no-op command to the remote server on an interval to prevent.
	 *
	 * @param delay
	 * Amount of time to wait between heartbeats.
	 */
	ProxiedSession.prototype.setHeartbeatInterval = function (/**number*/ delay) {
		this._heartbeatIntervalHandle && this._heartbeatIntervalHandle.remove();

		if (delay) {
			// A heartbeat command is sent immediately when the interval is set because it is unknown how long ago
			// the last command was sent and it simplifies the implementation by requiring only one call to
			// `setTimeout`
			var self = this;
			(function sendHeartbeat() {
				var timeoutId,
					cancelled = false,
					startTime = Date.now();

				self._heartbeatIntervalHandle = {
					remove: function () {
						cancelled = true;
						clearTimeout(timeoutId);
					}
				};

				self.getUrl().then(function () {
					if (!cancelled) {
						timeoutId = setTimeout(sendHeartbeat, delay - (Date.now() - startTime));
					}
				});
			})();
		}
	};

	return ProxiedSession;
});
