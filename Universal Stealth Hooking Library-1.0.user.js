// ==UserScript==
// @name         Universal Stealth Hooking System
// @namespace    http://tampermonkey.net/
// @version      5.0
// @description  Universal hooking with working TextDecoder and Function hooks
// @author       L3Hong
// @match        *://*/*
// @run-at       document-start
// @grant        none
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    function onReady(callback) {
        if (document.readyState === "complete" || document.readyState === "interactive") {
            setTimeout(callback, 0);
        } else {
            document.addEventListener("DOMContentLoaded", callback, { once: true });
        }
    }

    // Store all original functions and hooks
    const originals = {};
    const hooks = {};

    // Universal hook function - YOUR WORKING APPROACH
    function stealthHookFunction(targetName, methodName, processFunction) {
        const original = getNestedProperty(window, targetName);
        if (!original || typeof original !== 'function') {
            console.error(`Target not found: ${targetName}`);
            return false;
        }

        originals[targetName] = original;

        // YOUR exact working approach
        const hookedFunction = function(...args) {
            const instance = new original(...args);

            // Cache original method
            const originalMethod = instance[methodName];

            // Redefine method on the instance
            if (originalMethod && typeof originalMethod === 'function') {
                Object.defineProperty(instance, methodName, {
                    value: function(...methodArgs) {
                        const result = originalMethod.call(this, ...methodArgs);
                        return processFunction(result, methodArgs, originalMethod);
                    },
                    writable: false,
                    configurable: false,
                    enumerable: true
                });
            }

            return instance;
        };

        // Preserve prototype and properties (YOUR approach)
        hookedFunction.prototype = original.prototype;
        Object.defineProperties(hookedFunction, {
            name: { value: original.name, configurable: false },
            length: { value: original.length, configurable: false }
        });

        // Apply hook (YOUR timing approach)
        setTimeout(() => {
            try {
                setNestedProperty(window, targetName, hookedFunction);
                hooks[targetName] = { method: methodName, processor: processFunction };
                console.log(`Hook applied to ${targetName}.${methodName}`);
            } catch(e) {
                // Silent fail
            }
        }, 0);

        return true;
    }

    // Hook for regular functions (not constructors)
    function stealthHookMethod(targetName, methodName, processFunction) {
        const targetObj = getNestedProperty(window, targetName.split('.').slice(0, -1).join('.'));
        const method = getNestedProperty(window, targetName);
        
        if (!targetObj || !method || typeof method !== 'function') {
            console.error(`Method not found: ${targetName}`);
            return false;
        }

        const original = method;
        const methodKey = targetName.split('.').pop();

        originals[targetName] = original;

        const hookedMethod = function(...args) {
            const result = original.apply(this, args);
            return processFunction(result, args, original);
        };

        // Preserve function properties
        Object.defineProperties(hookedMethod, {
            name: { value: original.name, configurable: false },
            length: { value: original.length, configurable: false }
        });

        setTimeout(() => {
            try {
                setNestedProperty(window, targetName, hookedMethod);
                hooks[targetName] = { method: methodName, processor: processFunction, type: 'method' };
                console.log(`Hook applied to ${targetName}`);
            } catch(e) {
                // Silent fail
            }
        }, 0);

        return true;
    }

    // Hook for Function constructor (special handling)
    function stealthHookFunctionConstructor(processFunction) {
        const originalFunction = window.Function;
        originals['Function'] = originalFunction;

        const hookedFunction = function(...args) {
            // Process the function code before creating the function
            if (args.length > 0 && typeof args[args.length - 1] === 'string') {
                const code = args[args.length - 1];
                const processedCode = processFunction(code, args, originalFunction);
                if (typeof processedCode === 'string') {
                    args[args.length - 1] = processedCode;
                }
            }

            return originalFunction.apply(this, args);
        };

        // Preserve Function constructor properties
        hookedFunction.prototype = originalFunction.prototype;
        Object.defineProperties(hookedFunction, {
            name: { value: 'Function', configurable: false },
            length: { value: originalFunction.length, configurable: false }
        });

        setTimeout(() => {
            try {
                window.Function = hookedFunction;
                hooks['Function'] = { method: 'constructor', processor: processFunction, type: 'constructor' };
                console.log('Hook applied to Function constructor');
            } catch(e) {
                // Silent fail
            }
        }, 0);

        return true;
    }

    // Helper functions
    function getNestedProperty(obj, path) {
        return path.split('.').reduce((current, part) => current && current[part], obj);
    }

    function setNestedProperty(obj, path, value) {
        const parts = path.split('.');
        const last = parts.pop();
        const target = parts.reduce((current, part) => current[part] = current[part] || {}, obj);
        target[last] = value;
    }

    // YOUR redefinition protection
    function hookRedefinitions() {
        let redefinitionCount = {};
        const originalDefine = Object.defineProperty;

        Object.defineProperty = function(obj, prop, descriptor) {
            if (obj === window && hooks[prop]) {
                redefinitionCount[prop] = (redefinitionCount[prop] || 0) + 1;
                if (redefinitionCount[prop] > 2) {
                    return originalDefine.call(this, obj, prop, descriptor);
                }
                return obj;
            }
            return originalDefine.call(this, obj, prop, descriptor);
        };
    }

    // YOUR existing instance hooking
    function hookExistingInstances() {
        const originalFunction = Function.prototype.constructor;
        Function.prototype.constructor = function(...args) {
            if (args.length > 0 && typeof args[0] === 'string') {
                const code = args[0];
                for (const targetName in hooks) {
                    const hook = hooks[targetName];
                    if (code.includes(targetName) && code.includes(hook.method)) {
                        const modified = code.replace(
                            new RegExp(`new\\s+${targetName}`, 'g'),
                            `new (function(...args){const i=new ${targetName}(...args);const d=i.${hook.method};i.${hook.method}=function(...methodArgs){const r=d.call(this,...methodArgs);return (${hook.processor.toString()})(r,methodArgs,d)};return i})`
                        );
                        return originalFunction.apply(this, [modified, ...args.slice(1)]);
                    }
                }
            }
            return originalFunction.apply(this, args);
        };
    }

    // Enhanced hooking with multiple types
    window.UniversalHook = {
        // Hook constructors (like TextDecoder)
        hookConstructor: function(targetName, methodName, processFunction) {
            return stealthHookFunction(targetName, methodName, processFunction);
        },

        // Hook regular methods (like console.log, fetch)
        hookMethod: function(targetName, processFunction) {
            return stealthHookMethod(targetName, targetName.split('.').pop(), processFunction);
        },

        // Hook Function constructor specifically
        hookFunctionConstructor: function(processFunction) {
            return stealthHookFunctionConstructor(processFunction);
        },

        // Remove a hook
        removeHook: function(targetName) {
            if (originals[targetName]) {
                setNestedProperty(window, targetName, originals[targetName]);
                delete hooks[targetName];
                delete originals[targetName];
                console.log(`Hook removed for ${targetName}`);
                return true;
            }
            return false;
        },

        // Get all active hooks
        getHooks: function() {
            return { ...hooks };
        },

        // Enable/disable debug
        debug: function(enabled) {
            window.UNIVERSAL_HOOK_DEBUG = enabled;
        }
    };

    // Initialize
    onReady(() => {
        // Apply your hooks here - EXAMPLES:

        // 1. TextDecoder hook (YOUR WORKING CODE)
        UniversalHook.hookConstructor('TextDecoder', 'decode', function(result, args, original) {
            if (typeof result === 'string') {
                console.log('[TextDecoder] Intercepted text length:', result.length);
                
                // Your text processing here
                if (result.includes('game') || result.includes('player')) {
                    console.log('[TextDecoder] Found game-related content');
                }
                
                // Example modification:
                // return result.replace(/secret/gi, 'REDACTED');
            }
            return result;
        });

        // 2. Function constructor hook
        UniversalHook.hookFunctionConstructor(function(code, args, original) {
            console.log('[Function] Creating function with code:', code.substring(0, 200));
            
            // You can modify the code here
            // Example: Prevent certain function creations
            if (code.includes('debugger') || code.includes('antiCheat')) {
                console.log('[Function] Blocked suspicious function creation');
                return '/* blocked */';
            }
            
            return code;
        });

        // 3. Fetch hook
        UniversalHook.hookMethod('fetch', function(result, args, original) {
            console.log('[Fetch] Called with URL:', args[0]);
            
            // Handle Promise
            if (result instanceof Promise) {
                return result.then(async (response) => {
                    try {
                        const clone = response.clone();
                        const text = await clone.text();
                        console.log('[Fetch] Response length:', text.length);
                    } catch(e) {
                        // Ignore non-text responses
                    }
                    return response;
                });
            }
            
            return result;
        });

        // 4. Console log hook
        UniversalHook.hookMethod('console.log', function(result, args, original) {
            console.warn('[Console.log] Intercepted:', args);
            // Return undefined to prevent original console.log
            // Or return result to allow it
            return result;
        });

        hookRedefinitions();
        hookExistingInstances();
        
        console.log('Universal Hook System initialized with', Object.keys(hooks).length, 'hooks');
    });

})();
