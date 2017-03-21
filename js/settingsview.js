/* global Backbone, Handlebars, OC, u2f, Promise */

(function (OC, OCA, Backbone, Handlebars, $, u2f) {
	'use strict';

	OCA.TwoFactorU2F = OCA.TwoFactorU2F || {};

	var TEMPLATE = ''
		+ '<div>'
		+ '	{{#unless loading}}'
		+ '     <div>'
		+ '         {{#unless devices.length}}'
		+ '         <span>' + t('twofactor_u2f', 'No U2F devices configured. You are not using U2F as second factor at the moment.') + '</span>'
		+ '         {{/unless}}'
		+ '         <span>' + t('twofactor_u2f', 'The following devices are configured for U2F second-factor authentication:') + '</span>'
		+ '         {{#each devices}}'
		+ '         <div class="u2f-device">'
		+ '             <span class="icon-u2f-device"></span>'
		+ '             <span data-u2f-id="{{id}}">{{#if name}}{{name}}{{else}}' + t('twofactor_u2f', 'Unnamed device') + '{{/if}}</span>'
		+ '         </div>'
		+ '         {{/each}}'
		+ '     </div>'
		+ '     <input  id="u2f-device-name" type="text" placeholder="Name your device">'
		+ '	<button id="add-u2f-device">' + t('twofactor_u2f', 'Add U2F device') + '</button><br>'
		+ '     <span><small>' + t('twofactor_u2f', 'You can add as many devices as you like. It is recommended to give each device a distinct name.') + '</small></span>'
		+ '	{{else}}'
		+ '     <span class="icon-loading-small u2f-loading"></span>'
		+ '	<span>' + t('twofactor_u2f', 'Adding a new device …') + '</span>'
		+ '	{{/unless}}'
		+ '</div>';

	/**
	 * @class
	 */
	var SettingsView = Backbone.View.extend(/** @lends Backbone.View */ {

		/**
		 * @type {function|undefined}
		 */
		_template: undefined,

		/**
		 * @type {boolean}
		 */
		_loading: false,

		/**
		 * @type {Object[]}
		 */
		_devices: undefined,

		/**
		 * @param {object} data
		 * @returns {string}
		 */
		template: function (data) {
			if (!this._template) {
				this._template = Handlebars.compile(TEMPLATE);
			}
			return this._template(data);
		},

		events: {
			'click #add-u2f-device': '_onAddU2FDevice'
		},

		/**
		 * @returns {undefined}
		 */
		render: function () {
			this.$el.html(this.template({
				loading: this._loading,
				devices: this._devices
			}));
		},

		/**
		 * @private
		 * @returns {Promise}
		 */
		_getServerState: function () {
			var url = OC.generateUrl('/apps/twofactor_u2f/settings/state');
			return Promise.resolve($.ajax(url, {
				method: 'GET'
			}));
		},

		/**
		 * @returns {Promise}
		 */
		load: function () {
			return this._getServerState().then(function (data) {
				this._devices = data.devices;
				this.render();
			}.bind(this), function () {
				OC.Notification.showTemporary('Could not load list of U2F devices.');
			}).catch(console.error.bind(this));
		},

		/**
		 * @private
		 * @returns {Promise}
		 */
		_onAddU2FDevice: function () {
			if (this._loading) {
				// Ignore event
				return Promise.resolve();
			}

			return this._onRegister();
		},

		/**
		 * @private
		 * @returns {Promise}
		 */
		_onRegister: function () {
			var name = this.$('#u2f-device-name').val();

			// Show loading feedback
			this._loading = true;
			this.render();

			var self = this;
			return this._requirePasswordConfirmation()
				.then(this._startRegistrationOnServer)
				.then(function (data) {
					return self._registerU2fDevice(data.req, data.sigs);
				})
				.then(function (data) {
					data.name = name;
					return self._finishRegisterOnServer(data);
				})
				.then(function (newDevice) {
					self._devices.push(newDevice);
				})
				.catch(function (e) {
					OC.Notification.showTemporary(e.message);
				})
				.then(function () {
					self._loading = false;
					self.render();
				});
		},

		/**
		 * @private
		 * @returns {Promise}
		 */
		_startRegistrationOnServer: function () {
			var url = OC.generateUrl('/apps/twofactor_u2f/settings/startregister');
			return Promise.resolve($.ajax(url, {
				method: 'POST'
			})).catch(function (e) {
				console.error(e);
				throw new Error(t('twofactor_u2f', 'Server error while trying to add U2F device'));
			});
		},

		/**
		 * @private
		 * @returns {Promise}
		 */
		_onDisable: function () {
			this._loading = true;
			this.render();

			var self = this;
			return this._requirePasswordConfirmation()
				.then(this._disableU2fOnServer)
				.catch(function (e) {
					OC.Notification.showTemporary(e);
				})
				.then(function () {
					self._loading = false;
					self.render();
				});
		},

		/**
		 * @private
		 * @returns {Promise}
		 */
		_disableU2fOnServer: function () {
			var url = OC.generateUrl('apps/twofactor_u2f/settings/disable');
			return Promise.resolve($.ajax(url, {
				method: 'POST'
			})).catch(function (e) {
				console.error(e);
				throw new Error(t('twofactor_u2f', 'Server error while disabling U2F'));
			});
		},

		/**
		 * @private
		 * @returns {Promise}
		 */
		_requirePasswordConfirmation: function () {
			if (!OC.PasswordConfirmation.requiresPasswordConfirmation()) {
				return Promise.resolve();
			}
			return new Promise(function (resolve) {
				OC.PasswordConfirmation.requirePasswordConfirmation(resolve);
			});
		},

		/**
		 * @private
		 * @param {object} req
		 * @param {object} sigs
		 * @returns {Promise}
		 */
		_registerU2fDevice: function (req, sigs) {
			$('.utf-register-info').slideDown();
			var pathArray = location.href.split('/');
			var protocol = pathArray[0];
			var host = pathArray[2];
			var url = protocol + '//' + host;

			return new Promise(function (resolve, reject) {
				u2f.register(url, [req], sigs, function (data) {
					if (data.errorCode && data.errorCode !== 0) {
						$('.utf-register-info').slideUp();
						reject(new Error(t('twofactor_u2f', 'U2F device registration failed (error code {errorCode})', {
							errorCode: data.errorCode
						})));
						return;
					}
					resolve(data);
				});
			});
		},

		/**
		 * @private
		 * @param {Object} data
		 * @param {string} data.name device name (specified by the user)
		 * @returns {Promise}
		 */
		_finishRegisterOnServer: function (data) {
			var url = OC.generateUrl('/apps/twofactor_u2f/settings/finishregister');
			return Promise.resolve($.ajax(url, {
				method: 'POST',
				data: data
			})).catch(function (e) {
				console.error(e);
				throw new Error(t('twofactor_u2f', 'Server error while trying to complete U2F device registration'));
			}).then(function (data) {
				$('.utf-register-info').slideUp();
				return data;
			});
		}
	});

	OCA.TwoFactorU2F.SettingsView = SettingsView;

})(OC, OCA, OC.Backbone, Handlebars, $, u2f);
