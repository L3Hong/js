// ==UserScript==
// @name         Kr Patch
// @namespace    http://tampermonkey.net/
// @version      1.2.0
// @description  Injects __kr = { kr, krArgs } – single global object
// @author       Skid
// @match        http*://krunker.io/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function(){
    'use strict';
    const NativeFunction = window.Function;
    let injected = false;

    function injectIntoBundle(code) {
        const target = "=new function(";
        let result = code;
        let offset = 0;
        for (let pos = 0; (pos = result.indexOf(target, pos)) !== -1; pos += target.length) {
            const closeParen = result.indexOf(")", pos + target.length);
            if (closeParen === -1) continue;
            const params = result.substring(pos + target.length, closeParen);
            const paramCount = params.length === 0 ? 0 : params.split(",").length;
            const openBrace = result.indexOf("{", closeParen);
            if (paramCount === 11 && openBrace !== -1) {
                // Single combined object
                const injection = "window.__kr = { kr: this, krArgs: arguments };";
                const insertPos = openBrace + 1 + offset;
                result = result.slice(0, insertPos) + injection + result.slice(insertPos);
                offset += injection.length;
                injected = true;
                break;
            }
        }
        return result;
    }

    const Hooked = function(...args) {
        const src = args[args.length-1];
        if (!injected && typeof src === "string" && src.length > 7e6) {
            const modified = injectIntoBundle(src);
            if (modified !== src) args[args.length-1] = modified;
            queueMicrotask(() => { window.Function = NativeFunction; });
        }
        return new.target
            ? Reflect.construct(NativeFunction, args, new.target)
            : Reflect.apply(NativeFunction, this, args);
    };
    Hooked.prototype = NativeFunction.prototype;
    window.Function = Hooked;
})();