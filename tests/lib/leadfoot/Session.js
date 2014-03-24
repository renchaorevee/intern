define([
	'intern!object',
	'intern/chai!assert',
	'./support/util',
	'require'
], function (registerSuite, assert, util, require) {
	registerSuite(function () {
		var session;

		return {
			name: 'lib/leadfoot/Session',

			setup: function () {
				session = util.createSessionFromRemote(this.remote);
			},

			beforeEach: function () {
				return session.get('about:blank');
			},

			'#getCapabilities': function () {
				return session.getCapabilities().then(function (capabilities) {
					assert.isObject(capabilities);
				});
			},

			'#getTimeout script': function () {
				return session.getTimeout('script').then(function (value) {
					assert.strictEqual(value, 0, 'Async execution timeout should be default value');
				});
			},

			'#getTimeout implicit': function () {
				return session.getTimeout('implicit').then(function (value) {
					assert.strictEqual(value, 0, 'Implicit timeout should be default value');
				});
			},

			'#getTimeout page load': function () {
				return session.getTimeout('page load').then(function (value) {
					assert.strictEqual(value, Infinity, 'Page load timeout should be default value');
				});
			},

			'#setTimeout': function () {
				// TODO
			},

			'window handle information (#getCurrentWindowHandle, #getAllWindowHandles)': function () {
				var currentHandle;

				return session.getCurrentWindowHandle().then(function (handle) {
					assert.isString(handle);
					currentHandle = handle;
					return session.getAllWindowHandles();
				}).then(function (handles) {
					assert.isArray(handles);
					assert.lengthOf(handles, 1);
					assert.strictEqual(handles[0], currentHandle);
				});
			},

			'#get': function () {
				return session.get(require.toUrl('./data/default.html'));
			},

			'#get 404': function () {
				return session.get(require.toUrl('./data/404.html'));
			},

			'#getCurrentUrl': function () {
				var expectedUrl = util.convertPathToUrl(this.remote, require.toUrl('./data/default.html'));

				return session.get(expectedUrl).then(function () {
					return session.getCurrentUrl();
				}).then(function (currentUrl) {
					assert.strictEqual(currentUrl, expectedUrl);
				});
			},

			'navigation (#refresh, #goBack, #goForward)': function () {
				var expectedUrl = util.convertPathToUrl(this.remote, require.toUrl('./data/default.html?second'));
				var expectedBackUrl = util.convertPathToUrl(this.remote, require.toUrl('./data/default.html?first'));

				return session.get(expectedBackUrl).then(function () {
					return session.get(expectedUrl);
				}).then(function () {
					return session.refresh();
				}).then(function () {
					return session.getCurrentUrl();
				}).then(function (currentUrl) {
					assert.strictEqual(currentUrl, expectedUrl, 'Refreshing the page should load the same URL');
					return session.goBack();
				}).then(function () {
					return session.getCurrentUrl();
				}).then(function (currentUrl) {
					assert.strictEqual(currentUrl, expectedBackUrl);
					return session.goForward();
				}).then(function () {
					return session.getCurrentUrl();
				}).then(function (currentUrl) {
					assert.strictEqual(currentUrl, expectedUrl);
				});
			},

			'#execute string': function () {
				return session.get(require.toUrl('./data/scripting.html'))
					.then(function () {
						return session.execute(
							'return interns[arguments[0]] + interns[arguments[1]];',
							[ 'ness', 'paula' ]
						);
					})
					.then(function (result) {
						assert.strictEqual(result, 'NessPaula');
					});
			},

			'#execute function': function () {
				return session.get(require.toUrl('./data/scripting.html'))
					.then(function () {
						return session.execute(function (first, second) {
							/*global interns:false */
							return interns[first] + interns[second];
						}, [ 'ness', 'paula' ]);
					})
					.then(function (result) {
						assert.strictEqual(result, 'NessPaula');
					});
			},

			'#execute -> element': function () {
				return session.get(require.toUrl('./data/scripting.html'))
					.then(function () {
						return session.execute(function () {
							return document.getElementById('child');
						});
					})
					.then(function (element) {
						assert.property(element, 'elementId', 'Returned value should be an Element object');
					});
			},

			'#execute -> elements': function () {
				return session.get(require.toUrl('./data/scripting.html'))
					.then(function () {
						return session.execute(function () {
							return [ interns.poo, document.getElementById('child') ];
						});
					})
					.then(function (elements) {
						assert.isArray(elements);
						assert.strictEqual(elements[0], 'Poo', 'Non-elements should not be converted');
						assert.property(elements[1], 'elementId', 'Returned elements should be Element objects');
					});
			},

			'#execute -> error': function () {
				return session.get(require.toUrl('./data/scripting.html'))
					.then(function () {
						return session.execute(function () {
							/*global interns:false */
							return interns();
						});
					})
					.then(function () {
						throw new Error('Invalid code execution should throw error');
					}, function (error) {
						assert.strictEqual(
							error.name,
							'JavaScriptError',
							'Invalid user code should throw per the spec'
						);
					});
			},

			'#executeAsync': (function () {
				var originalTimeout;

				return {
					setup: function () {
						return session.getTimeout('script').then(function (value) {
							originalTimeout = value;
							return session.setTimeout('script', 1000);
						});
					},
					'string': function () {
						return session.get(require.toUrl('./data/scripting.html'))
							.then(function () {
								/*jshint maxlen:140 */
								return session.executeAsync(
									'var args = arguments; setTimeout(function () { args[2](interns[args[0]] + interns[args[1]]); }, 100);',
									[ 'ness', 'paula' ]
								);
							})
							.then(function (result) {
								assert.strictEqual(result, 'NessPaula');
							});
					},
					'function': function () {
						return session.get(require.toUrl('./data/scripting.html'))
							.then(function () {
								return session.executeAsync(function (first, second, done) {
									setTimeout(function () {
										done(interns[first] + interns[second]);
									}, 100);
								}, [ 'ness', 'paula' ]);
							})
							.then(function (result) {
								assert.strictEqual(result, 'NessPaula');
							});
					},
					' -> error': function () {
						return session.get(require.toUrl('./data/scripting.html'))
							.then(function () {
								return session.executeAsync(function (done) {
									/*global interns:false */
									done(interns());
								});
							})
							.then(function () {
								throw new Error('Invalid code execution should throw error');
							}, function (error) {
								assert.strictEqual(
									error.name,
									'JavaScriptError',
									'Invalid user code should throw an error matching the spec'
								);
							});
					},
					teardown: function () {
						return session.setTimeout('script', originalTimeout);
					}
				};
			})(),

			'#takeScreenshot': function () {
				var magic = [ 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a ];

				return session.takeScreenshot().then(function (screenshot) {
					/*jshint node:true */
					assert.isTrue(Buffer.isBuffer(screenshot), 'Screenshot should be a Buffer');
					assert.deepEqual(screenshot.slice(0, 8).toJSON(), magic, 'Screenshot should be a PNG file');
				});
			},

			// TODO: There appear to be no drivers that support IME input to actually test IME commands

			'frame switching (#switchToFrame, #switchToParentFrame)': function () {
				return session.get(require.toUrl('./data/window.html')).then(function () {
					return session.getElementById('child');
				})
				.then(function (child) {
					return child.getVisibleText();
				})
				.then(function (text) {
					assert.strictEqual(text, 'Main');
					return session.switchToFrame('inlineFrame');
				})
				.then(function () {
					return session.getElementById('child');
				})
				.then(function (child) {
					return child.getVisibleText();
				})
				.then(function (text) {
					assert.strictEqual(text, 'Frame');
					return session.switchToParentFrame();
				})
				.then(function () {
					return session.getElementById('child');
				})
				.then(function (child) {
					return child.getVisibleText();
				})
				.then(function (text) {
					assert.strictEqual(text, 'Main');
				});
			},

			'window switching (#switchToWindow, #closeCurrentWindow)': function () {
				var mainHandle;
				return session.get(require.toUrl('./data/window.html')).then(function () {
					return session.getCurrentWindowHandle();
				}).then(function (handle) {
					mainHandle = handle;
					return session.getElementById('windowOpener');
				}).then(function (opener) {
					return opener.click();
				}).then(function () {
					return session.switchToWindow('popup');
				}).then(function () {
					return session.getCurrentWindowHandle();
				}).then(function (popupHandle) {
					assert.notStrictEqual(popupHandle, mainHandle, 'Window handle should have switched to pop-up');
					return session.closeCurrentWindow();
				}).then(function () {
					return session.getCurrentWindowHandle();
				}).then(function () {
					throw new Error('Window should have closed');
				}, function (error) {
					assert.strictEqual(error.name, 'NoSuchWindow');
					return session.switchToWindow(mainHandle);
				}).then(function () {
					return session.getCurrentWindowHandle();
				}).then(function (handle) {
					assert.strictEqual(handle, mainHandle, 'Window handle should have switched back to main window');
				});
			},

			'window sizing (#getWindowSize, #setWindowSize)': function () {
				var originalSize;
				var resizedSize;
				return session.getWindowSize().then(function (size) {
					assert.property(size, 'width');
					assert.property(size, 'height');
					originalSize = size;
					return session.setWindowSize(size.width + 20, size.height + 20);
				}).then(function () {
					return session.getWindowSize();
				}).then(function (size) {
					assert.strictEqual(size.width, originalSize.width + 20);
					assert.strictEqual(size.height, originalSize.height + 20);
					resizedSize = size;
					return session.maximizeWindow();
				}).then(function () {
					return session.getWindowSize();
				}).then(function (size) {
					assert.operator(size.width, '>', resizedSize.width);
					assert.operator(size.height, '>', resizedSize.height);
				}).then(function () {
					return session.setWindowSize(originalSize.width, originalSize.height);
				});
			},

			'window positioning (#getWindowPosition, #setWindowPosition)': function () {
				var originalPosition;
				return session.getWindowPosition().then(function (position) {
					assert.property(position, 'x');
					assert.property(position, 'y');
					originalPosition = position;
					return session.setWindowPosition(position.x + 2, position.y + 2);
				}).then(function () {
					return session.getWindowPosition();
				}).then(function (position) {
					assert.strictEqual(position.x, originalPosition.x + 2);
					assert.strictEqual(position.y, originalPosition.y + 2);
				});
			},

			'cookies': function () {
				// TODO
			},

			'#getPageSource': function () {
				// Page source is serialised from the current DOM, so will not match the original source on file
				return session.get(require.toUrl('./data/default.html')).then(function () {
					return session.getPageSource();
				}).then(function (source) {
					assert.include(source, '<!DOCTYPE ');
					assert.include(source, 'Are you kay-o?');
				});
			},

			'#getPageTitle': function () {
				return session.get(require.toUrl('./data/default.html')).then(function () {
					return session.getPageTitle();
				}).then(function (pageTitle) {
					assert.strictEqual(pageTitle, 'Default');
				});
			},

			'#getElement': function () {
				// TODO
			},

			// TODO: Test element with implicit timeout
			// TODO: Test element getter convenience methods

			'#getActiveElement': function () {
				// TODO
			},

			'#type': function () {
				var formElement;

				return session.get(require.toUrl('./data/form.html')).then(function () {
					return session.getElementById('input');
				}).then(function (element) {
					formElement = element;
					return element.click();
				}).then(function () {
					return session.type('hello, world');
				}).then(function () {
					return formElement.getAttribute('value');
				}).then(function (value) {
					assert.strictEqual(value, 'hello, world');
				});
			},

			'#getOrientation': function () {
				return session.getOrientation().then(function (value) {
					console.log(value);
				});
			},

			'#setOrientation': function () {
				return session.setOrientation('LANDSCAPE').then(function () {

				});
			},

			'#getAlertText': function () {
				return session.get(require.toUrl('./data/prompts.html')).then(function () {
					return session.getElementById('alert');
				}).then(function (element) {
					return element.click();
				}).then(function () {
					return session.getAlertText();
				}).then(function (alertText) {
					assert.strictEqual(alertText, 'Oh, you thank.');
					return session.acceptAlert();
				}).then(function () {
					return session.execute('return result.alert;');
				}).then(function (result) {
					assert.isTrue(result);
				});
			},

			'#typeInPrompt': function () {
				return session.get(require.toUrl('./data/prompts.html')).then(function () {
					return session.getElementById('prompt');
				}).then(function (element) {
					return element.click();
				}).then(function () {
					return session.getAlertText();
				}).then(function (alertText) {
					assert.strictEqual(alertText, 'The monkey... got charred. Is he all right?');
					return session.typeInPrompt('yes');
				}).then(function () {
					return session.acceptAlert();
				}).then(function () {
					return session.execute('return result.prompt;');
				}).then(function (result) {
					assert.strictEqual(result, 'yes');
				});
			},

			'#acceptAlert': function () {
				return session.get(require.toUrl('./data/prompts.html')).then(function () {
					return session.getElementById('confirm');
				}).then(function (element) {
					return element.click();
				}).then(function () {
					return session.getAlertText();
				}).then(function (alertText) {
					assert.strictEqual(alertText, 'Would you like some bananas?');
					return session.acceptAlert();
				}).then(function () {
					return session.execute('return result.confirm;');
				}).then(function (result) {
					assert.isTrue(result);
				});
			},

			'#dismissAlert': function () {
				return session.get(require.toUrl('./data/prompts.html')).then(function () {
					return session.getElementById('confirm');
				}).then(function (element) {
					return element.click();
				}).then(function () {
					return session.getAlertText();
				}).then(function (alertText) {
					assert.strictEqual(alertText, 'Would you like some bananas?');
					return session.dismissAlert();
				}).then(function () {
					return session.execute('return result.confirm;');
				}).then(function (result) {
					assert.isFalse(result);
				});
			}
		};
	});
});
