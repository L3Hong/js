// ==UserScript==
// @name         Universal Stealth Hooking Library
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  Universal hooking system
// @author       L3Hong
// @match        *://*/*
// @run-at       document-start
// @grant        none
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    // Don't redefine if already loaded
    if (window.UniversalHook) {
        return;
    }

    // Universal Hooking System
    const UniversalHook = {
        config: {
            hooks: {},
            stealthMode: true,
            debug: false,
            autoApply: true,
            redefinitionCount: {}
        },

        // Initialize the system
        init() {
            this.log('Universal Hooking System initialized');
            this.setupDOMReady();
            return this;
        },

        // Add a hook configuration
        addHook(target, options) {
            if (!target || !options.method) {
                this.log('Invalid hook configuration', {target, options});
                return false;
            }

            this.config.hooks[target] = {
                ...options,
                id: this.generateId(),
                active: true,
                original: null,
                hooked: null,
                addedAt: Date.now()
            };

            this.log(`Hook added for ${target}.${options.method}`);
            
            // Auto-apply if system is already running
            if (this.config.autoApply) {
                setTimeout(() => this.applyHook(target), 0);
            }
            
            return true;
        },

        // Add multiple hooks at once
        addHooks(hookDefinitions) {
            if (!Array.isArray(hookDefinitions)) {
                this.log('addHooks expects an array of hook definitions');
                return false;
            }

            let successCount = 0;
            hookDefinitions.forEach(hookDef => {
                if (this.addHook(hookDef.target, hookDef.options)) {
                    successCount++;
                }
            });

            this.log(`Added ${successCount}/${hookDefinitions.length} hooks`);
            return successCount;
        },

        // Remove a hook
        removeHook(target) {
            if (this.config.hooks[target]) {
                this.restoreOriginal(target);
                delete this.config.hooks[target];
                this.log(`Hook removed for ${target}`);
                return true;
            }
            return false;
        },

        // Enable/disable a hook
        setHookState(target, active) {
            if (this.config.hooks[target]) {
                this.config.hooks[target].active = active;
                this.log(`Hook ${target} ${active ? 'enabled' : 'disabled'}`);
                return true;
            }
            return false;
        },

        // Apply all configured hooks
        applyHooks() {
            this.log(`Applying ${Object.keys(this.config.hooks).length} hooks`);
            for (const target in this.config.hooks) {
                if (this.config.hooks[target].active) {
                    this.applyHook(target);
                }
            }
            this.setupRedefinitionProtection();
        },

        // Apply a specific hook
        applyHook(target) {
            const hookConfig = this.config.hooks[target];
            if (!hookConfig) return false;

            try {
                const targetPath = target.split('.');
                let current = window;
                
                // Navigate to the target object
                for (let i = 0; i < targetPath.length - 1; i++) {
                    if (!current[targetPath[i]]) {
                        this.log(`Target path not found: ${targetPath.slice(0, i + 1).join('.')}`);
                        return false;
                    }
                    current = current[targetPath[i]];
                }

                const methodName = targetPath[targetPath.length - 1];
                const original = current[methodName];

                if (typeof original !== 'function') {
                    this.log(`Target is not a function: ${target}`);
                    return false;
                }

                // Store original
                hookConfig.original = original;

                // Create hooked version
                let hooked;
                if (this.isConstructor(target, original)) {
                    hooked = this.createHookedConstructor(target, hookConfig);
                } else {
                    hooked = this.createHookedFunction(target, hookConfig);
                }
                
                // Apply hook with stealth
                if (this.config.stealthMode) {
                    this.stealthApplyHook(current, methodName, hooked, original);
                } else {
                    current[methodName] = hooked;
                }

                hookConfig.hooked = hooked;
                hookConfig.appliedAt = Date.now();
                this.log(`Hook applied to ${target}`);
                return true;

            } catch (error) {
                this.log(`Error applying hook to ${target}:`, error);
                return false;
            }
        },

        // Check if target is a constructor
        isConstructor(target, original) {
            const constructors = [
                'TextDecoder', 'TextEncoder', 'XMLHttpRequest', 'Blob', 
                'File', 'FileReader', 'WebSocket', 'EventSource',
                'AudioContext', 'OfflineAudioContext', 'RTCPeerConnection'
            ];
            
            const targetName = target.split('.').pop();
            return constructors.includes(targetName);
        },

        // Create hooked constructor using your proven approach
        createHookedConstructor(target, hookConfig) {
            const original = hookConfig.original;
            const self = this;

            // Your working approach for TextDecoder
            const hookedConstructor = function(...args) {
                // Create instance with original constructor
                const instance = new original(...args);

                // Cache original method
                const originalMethod = instance[hookConfig.method];

                // Redefine method on the instance
                if (originalMethod && typeof originalMethod === 'function') {
                    Object.defineProperty(instance, hookConfig.method, {
                        value: function(...methodArgs) {
                            const result = originalMethod.apply(this, methodArgs);
                            
                            // Apply beforeCall hook if provided
                            let processedResult = result;
                            if (hookConfig.beforeCall) {
                                try {
                                    processedResult = hookConfig.beforeCall.call(this, result, methodArgs, originalMethod);
                                } catch (e) {
                                    self.log(`Error in beforeCall for ${target}.${hookConfig.method}:`, e);
                                }
                            }
                            
                            // Apply afterCall hook if provided
                            if (hookConfig.afterCall) {
                                try {
                                    processedResult = hookConfig.afterCall.call(this, processedResult, methodArgs, originalMethod);
                                } catch (e) {
                                    self.log(`Error in afterCall for ${target}.${hookConfig.method}:`, e);
                                }
                            }
                            
                            return processedResult !== undefined ? processedResult : result;
                        },
                        writable: false,
                        configurable: false,
                        enumerable: true
                    });
                }

                return instance;
            };

            // Preserve prototype and properties (your working approach)
            hookedConstructor.prototype = original.prototype;
            Object.defineProperties(hookedConstructor, {
                name: { value: original.name, configurable: false },
                length: { value: original.length, configurable: false }
            });

            return hookedConstructor;
        },

        // Create the hooked function for regular functions
        createHookedFunction(target, hookConfig) {
            const self = this;
            
            const hookedFunction = function(...args) {
                const hook = self.config.hooks[target];
                if (!hook || !hook.active) {
                    return hook.original.apply(this, args);
                }

                // Pre-process arguments if callback provided
                let processedArgs = args;
                if (hook.beforeCall) {
                    try {
                        processedArgs = hook.beforeCall.call(this, args, hook.original);
                        if (!Array.isArray(processedArgs)) {
                            processedArgs = args;
                        }
                    } catch (e) {
                        self.log(`Error in beforeCall for ${target}:`, e);
                        processedArgs = args;
                    }
                }

                // Call original function
                let result;
                try {
                    result = hook.original.apply(this, processedArgs);
                } catch (error) {
                    if (hook.onError) {
                        const errorResult = hook.onError.call(this, error, processedArgs, hook.original);
                        if (errorResult !== undefined) {
                            return errorResult;
                        }
                    }
                    throw error;
                }

                // Handle promises
                if (result instanceof Promise) {
                    return result.then(async (resolvedResult) => {
                        if (hook.afterCall) {
                            try {
                                const processedResult = await hook.afterCall.call(this, resolvedResult, processedArgs, hook.original);
                                return processedResult !== undefined ? processedResult : resolvedResult;
                            } catch (e) {
                                self.log(`Error in afterCall (async) for ${target}:`, e);
                                return resolvedResult;
                            }
                        }
                        return resolvedResult;
                    }).catch(error => {
                        if (hook.onError) {
                            const errorResult = hook.onError.call(this, error, processedArgs, hook.original);
                            if (errorResult !== undefined) {
                                return Promise.resolve(errorResult);
                            }
                        }
                        return Promise.reject(error);
                    });
                }

                // Post-process result if callback provided
                if (hook.afterCall) {
                    try {
                        const processedResult = hook.afterCall.call(this, result, processedArgs, hook.original);
                        return processedResult !== undefined ? processedResult : result;
                    } catch (e) {
                        self.log(`Error in afterCall for ${target}:`, e);
                        return result;
                    }
                }

                return result;
            };

            // Preserve function properties
            this.preserveFunctionProperties(hookedFunction, hookConfig.original);
            return hookedFunction;
        },

        // Preserve original function properties
        preserveFunctionProperties(hooked, original) {
            try {
                Object.defineProperties(hooked, {
                    name: { 
                        value: original.name || 'hooked', 
                        configurable: true 
                    },
                    length: { 
                        value: original.length, 
                        configurable: true 
                    },
                    toString: { 
                        value: function() { 
                            return `function ${original.name}() { [native code] }`; 
                        },
                        configurable: true
                    }
                });
            } catch (e) {
                this.log('Error preserving function properties:', e);
            }
        },

        // Stealth application of hook
        stealthApplyHook(obj, prop, hooked, original) {
            try {
                // Apply hook in multiple phases to avoid detection
                setTimeout(() => {
                    try {
                        obj[prop] = hooked;
                    } catch(e) {
                        // Silent fail
                    }
                }, 0);

            } catch (error) {
                this.log(`Stealth apply failed for ${prop}:`, error);
                // Fallback to direct assignment
                obj[prop] = hooked;
            }
        },

        // Setup redefinition protection (from your working code)
        setupRedefinitionProtection() {
            if (!this.config.stealthMode) return;

            const originalDefine = Object.defineProperty;
            const self = this;
            
            Object.defineProperty = function(obj, prop, descriptor) {
                if (obj === window) {
                    for (const target in self.config.hooks) {
                        const targetPath = target.split('.');
                        if (targetPath.length === 1 && targetPath[0] === prop) {
                            self.config.redefinitionCount[prop] = (self.config.redefinitionCount[prop] || 0) + 1;
                            if (self.config.redefinitionCount[prop] > 2) {
                                // Allow redefinition after our hook is established
                                return originalDefine.call(this, obj, prop, descriptor);
                            }
                            // Block early redefinitions that might be detection
                            self.log(`Blocked redefinition attempt of ${prop}`);
                            return obj;
                        }
                    }
                }
                return originalDefine.call(this, obj, prop, descriptor);
            };

            // Clean up protection after a while
            setTimeout(() => {
                Object.defineProperty = originalDefine;
                self.log('Redefinition protection removed');
            }, 10000);
        },

        // Hook existing instances (from your working code)
        hookExistingInstances() {
            const originalFunction = Function.prototype.constructor;
            const self = this;
            
            Function.prototype.constructor = function(...args) {
                if (args.length > 0 && typeof args[0] === 'string') {
                    const code = args[0];
                    
                    // Check for any hooked constructors in the code
                    for (const target in self.config.hooks) {
                        if (self.config.hooks[target].active && self.isConstructor(target, self.config.hooks[target].original)) {
                            const targetName = target.split('.').pop();
                            if (code.includes(targetName) && code.includes(self.config.hooks[target].method)) {
                                // Modify the code to include our hook
                                const modified = code.replace(
                                    new RegExp(`new\\s+${targetName}`, 'g'),
                                    `new (function(encoding,options){const i=new ${targetName}(encoding,options);const d=i.${self.config.hooks[target].method};i.${self.config.hooks[target].method}=function(input,opts){const r=d.call(this,input,opts);return self.config.hooks["${target}"].afterCall?self.config.hooks["${target}"].afterCall(r,[input,opts],d):r};return i})`
                                );
                                return originalFunction.apply(this, [modified, ...args.slice(1)]);
                            }
                        }
                    }
                }
                return originalFunction.apply(this, args);
            };

            // Restore after a while to avoid detection
            setTimeout(() => {
                Function.prototype.constructor = originalFunction;
            }, 5000);
        },

        // Get global object
        getGlobalObject() {
            if (typeof globalThis !== 'undefined') return globalThis;
            if (typeof window !== 'undefined') return window;
            if (typeof global !== 'undefined') return global;
            if (typeof self !== 'undefined') return self;
            return {};
        },

        // Restore original function
        restoreOriginal(target) {
            const hookConfig = this.config.hooks[target];
            if (!hookConfig || !hookConfig.original) return false;

            try {
                const targetPath = target.split('.');
                let current = window;
                
                for (let i = 0; i < targetPath.length - 1; i++) {
                    current = current[targetPath[i]];
                    if (!current) return false;
                }

                const methodName = targetPath[targetPath.length - 1];
                current[methodName] = hookConfig.original;
                
                this.log(`Original restored for ${target}`);
                return true;
            } catch (error) {
                this.log(`Error restoring original for ${target}:`, error);
                return false;
            }
        },

        // DOM ready handler (from your working code)
        setupDOMReady() {
            const self = this;
            
            function onReady(callback) {
                if (document.readyState === "complete" || document.readyState === "interactive") {
                    setTimeout(callback, 0);
                } else {
                    document.addEventListener("DOMContentLoaded", callback, { once: true });
                }
            }

            onReady(() => {
                self.applyHooks();
                self.hookExistingInstances();
            });
        },

        // Utility functions
        generateId() {
            return Math.random().toString(36).substr(2, 9);
        },

        log(...args) {
            if (this.config.debug) {
                console.log('[UniversalHook]', ...args);
            }
        },

        // Get hook status
        getStatus() {
            const status = {
                totalHooks: Object.keys(this.config.hooks).length,
                activeHooks: Object.values(this.config.hooks).filter(h => h.active).length,
                hooks: {}
            };

            for (const target in this.config.hooks) {
                status.hooks[target] = {
                    active: this.config.hooks[target].active,
                    applied: !!this.config.hooks[target].appliedAt,
                    method: this.config.hooks[target].method,
                    type: this.isConstructor(target, this.config.hooks[target].original) ? 'constructor' : 'function'
                };
            }

            return status;
        },

        // Public API
        enableDebug() {
            this.config.debug = true;
            this.log('Debug mode enabled');
            return this;
        },

        disableStealth() {
            this.config.stealthMode = false;
            this.log('Stealth mode disabled');
            return this;
        },

        setAutoApply(autoApply) {
            this.config.autoApply = autoApply;
            return this;
        },

        // Preset configurations
        presets: {
            // Text manipulation preset using your working approach
            textManipulation: function(config = {}) {
                return [
                    {
                        target: 'TextDecoder',
                        options: {
                            method: 'decode',
                            afterCall: config.textProcessor || function(result, args, original) {
                                if (typeof result === 'string') {
                                    console.log('[TextDecoder] Decoded text length:', result.length);
                                    // Add your text processing here
                                    // return result.replace(/pattern/gi, 'replacement');
                                }
                                return result;
                            }
                        }
                    }
                ];
            },

            // Network monitoring preset
            networkMonitor: function() {
                return [
                    {
                        target: 'fetch',
                        options: {
                            method: 'fetch',
                            beforeCall: function(args, original) {
                                console.log('[Fetch] Request:', args[0]);
                                return args;
                            }
                        }
                    },
                    {
                        target: 'XMLHttpRequest.prototype',
                        options: {
                            method: 'open',
                            beforeCall: function(args, original) {
                                console.log('[XHR] Open:', args[0], args[1]);
                                return args;
                            }
                        }
                    }
                ];
            }
        }
    };

    // Initialize and expose the hooking system
    window.UniversalHook = UniversalHook.init();

})();
