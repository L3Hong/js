// ==UserScript==
// @name         Universal Stealth Hooking Library
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Standalone universal hooking system
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
            autoApply: true
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

                // Special handling for TextDecoder
                if (target === 'TextDecoder') {
                    return this.applyTextDecoderHook(current, methodName, original, hookConfig);
                }

                if (typeof original !== 'function') {
                    this.log(`Target is not a function: ${target}`);
                    return false;
                }

                // Store original
                hookConfig.original = original;

                // Create hooked version for regular functions
                const hooked = this.createHookedFunction(target, hookConfig);
                
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

        // Special hook for TextDecoder that properly handles constructor AND decode method
        applyTextDecoderHook(current, methodName, original, hookConfig) {
            const self = this;
            
            // Store original
            hookConfig.original = original;

            // Create a proper constructor wrapper
            const HookedTextDecoder = function(...args) {
                if (!new.target) {
                    throw new TypeError("Failed to construct 'TextDecoder': Please use the 'new' operator");
                }
                
                // Create instance with original constructor
                const instance = new original(...args);
                
                // Hook the decode method on this specific instance
                const originalDecode = instance.decode;
                instance.decode = function(...decodeArgs) {
                    const result = originalDecode.apply(this, decodeArgs);
                    
                    // Apply the afterCall hook if provided
                    if (hookConfig.afterCall) {
                        try {
                            return hookConfig.afterCall.call(this, result, decodeArgs, originalDecode);
                        } catch (e) {
                            self.log('Error in TextDecoder.afterCall:', e);
                            return result;
                        }
                    }
                    
                    return result;
                };
                
                return instance;
            };

            // Copy prototype and static properties
            HookedTextDecoder.prototype = original.prototype;
            Object.defineProperty(HookedTextDecoder, 'name', { 
                value: 'TextDecoder', 
                configurable: true 
            });
            
            // Copy any static methods or properties
            Object.getOwnPropertyNames(original).forEach(prop => {
                if (prop !== 'length' && prop !== 'name' && prop !== 'prototype') {
                    try {
                        HookedTextDecoder[prop] = original[prop];
                    } catch (e) {
                        // Ignore errors for non-copyable properties
                    }
                }
            });

            // Apply the hooked constructor
            if (this.config.stealthMode) {
                this.stealthApplyHook(current, methodName, HookedTextDecoder, original);
            } else {
                current[methodName] = HookedTextDecoder;
            }

            hookConfig.hooked = HookedTextDecoder;
            hookConfig.appliedAt = Date.now();
            this.log('TextDecoder hook applied successfully');
            return true;
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
                            processedArgs = args; // Fallback to original args
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

                // Post-process result if callback provided (sync)
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
                // Method 1: Define property approach
                Object.defineProperty(obj, prop, {
                    value: hooked,
                    writable: true,
                    configurable: true,
                    enumerable: true
                });

            } catch (error) {
                this.log(`Stealth apply failed for ${prop}:`, error);
                // Fallback to direct assignment
                obj[prop] = hooked;
            }
        },

        // Setup redefinition protection
        setupRedefinitionProtection() {
            if (!this.config.stealthMode) return;

            const redefinitionCount = {};
            const originalDefine = Object.defineProperty;
            const self = this;
            
            Object.defineProperty = function(obj, prop, descriptor) {
                if (obj === window || obj === self.getGlobalObject()) {
                    for (const target in self.config.hooks) {
                        const targetPath = target.split('.');
                        if (targetPath.length === 1 && targetPath[0] === prop) {
                            redefinitionCount[prop] = (redefinitionCount[prop] || 0) + 1;
                            if (redefinitionCount[prop] > 2) {
                                self.log(`Allowing redefinition of ${prop} (count: ${redefinitionCount[prop]})`);
                                return originalDefine.call(this, obj, prop, descriptor);
                            }
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

        // Get global object (works in different environments)
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

        // DOM ready handler
        setupDOMReady() {
            const self = this;
            if (document.readyState === "complete" || document.readyState === "interactive") {
                setTimeout(() => self.applyHooks(), 0);
            } else {
                document.addEventListener("DOMContentLoaded", () => self.applyHooks(), { once: true });
            }
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
                    method: this.config.hooks[target].method
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
        }
    };

    // Initialize and expose the hooking system
    window.UniversalHook = UniversalHook.init();

})();
