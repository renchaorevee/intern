define([
	'dojo/Deferred',
	'../../../../lib/leadfoot/Server',
	'../../../../lib/leadfoot/Session'
], function (Deferred, Server, Session) {
	return {
		createServer: function (config) {
			var url = 'http://';
			if (config.accessKey) {
				url += encodeURIComponent(config.username) + ':' + encodeURIComponent(config.accessKey) + '@';
			}
			url += config.host + ':' + config.port + '/wd/hub';

			return new Server(url);
		},

		createServerFromRemote: function (remote) {
			if (remote._wd) {
				return new Server(remote._wd.configUrl.href);
			}

			throw new Error('Unsupported remote');
		},

		createSessionFromRemote: function (remote) {
			var server = this.createServerFromRemote(remote);
			var capabilities = remote.capabilities;

			// capabilities on Intern 1.5- remote objects are exposed through the environment type object,
			// but that object contains some additional features that causes a deepEqual comparison to fail;
			// extracting its own properties onto a plain object ensures that capabilities comparison passes,
			// assuming the server is not defective
			if (!capabilities && remote.environmentType) {
				capabilities = {};
				for (var k in remote.environmentType) {
					if (remote.environmentType.hasOwnProperty(k)) {
						capabilities[k] = remote.environmentType[k];
					}
				}
			}

			var session = new Session(remote.sessionId, server, capabilities);
			var self = this;

			var oldGet = session.get;
			session.get = function (url) {
				if (!/^(?:https?|about):/.test(url)) {
					url = self.convertPathToUrl(remote, url);
				}

				return oldGet.call(this, url);
			};

			return session;
		},

		convertPathToUrl: function (remote, url) {
			return remote.proxyUrl + url.slice(remote.proxyBasePathLength);
		},

		sleep: function (ms) {
			var dfd = new Deferred();
			setTimeout(function () {
				dfd.resolve();
			}, ms);
			return dfd.promise;
		}
	};
});
