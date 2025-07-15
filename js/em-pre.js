"use strict";

const version = 2;

const canvas = document.querySelector("#canvas");
var gl;

var clipboard = null;

var plugins = [];
var wasm_memory;
var animation_frame_timeout;

var high_dpi = false;
// if true, requestAnimationFrame will only be called from "schedule_update"
// if false, requestAnimationFrame will be called at the end of each frame
var blocking_event_loop = false;

canvas.focus();

canvas.requestPointerLock = canvas.requestPointerLock ||
    canvas.mozRequestPointerLock ||
    // pointer lock in any form is not supported on iOS safari 
    // https://developer.mozilla.org/en-US/docs/Web/API/Pointer_Lock_API#browser_compatibility
    (function () { });
document.exitPointerLock = document.exitPointerLock ||
    document.mozExitPointerLock ||
    // pointer lock in any form is not supported on iOS safari
    (function () { });

function assert(flag, message) {
    if (flag == false) {
        alert(message)
    }
}

function getArray(ptr, arr, n) {
    return new arr(wasm_memory.buffer, ptr, n);
}

function UTF8ToString(ptr, maxBytesToRead) {
    let u8Array = new Uint8Array(wasm_memory.buffer, ptr);

    var idx = 0;
    var endIdx = idx + maxBytesToRead;

    var str = '';
    while (!(idx >= endIdx)) {
        // For UTF8 byte structure, see:
        // http://en.wikipedia.org/wiki/UTF-8#Description
        // https://www.ietf.org/rfc/rfc2279.txt
        // https://tools.ietf.org/html/rfc3629
        var u0 = u8Array[idx++];

        // If not building with TextDecoder enabled, we don't know the string length, so scan for \0 byte.
        // If building with TextDecoder, we know exactly at what byte index the string ends, so checking for nulls here would be redundant.
        if (!u0) return str;

        if (!(u0 & 0x80)) { str += String.fromCharCode(u0); continue; }
        var u1 = u8Array[idx++] & 63;
        if ((u0 & 0xE0) == 0xC0) { str += String.fromCharCode(((u0 & 31) << 6) | u1); continue; }
        var u2 = u8Array[idx++] & 63;
        if ((u0 & 0xF0) == 0xE0) {
            u0 = ((u0 & 15) << 12) | (u1 << 6) | u2;
        } else {

            if ((u0 & 0xF8) != 0xF0) console.warn('Invalid UTF-8 leading byte 0x' + u0.toString(16) + ' encountered when deserializing a UTF-8 string on the asm.js/wasm heap to a JS string!');

            u0 = ((u0 & 7) << 18) | (u1 << 12) | (u2 << 6) | (u8Array[idx++] & 63);
        }

        if (u0 < 0x10000) {
            str += String.fromCharCode(u0);
        } else {
            var ch = u0 - 0x10000;
            str += String.fromCharCode(0xD800 | (ch >> 10), 0xDC00 | (ch & 0x3FF));
        }
    }

    return str;
}

function stringToUTF8(str, heap, outIdx, maxBytesToWrite) {
    var startIdx = outIdx;
    var endIdx = outIdx + maxBytesToWrite;
    for (var i = 0; i < str.length; ++i) {
        // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code unit, not a Unicode code point of the character! So decode UTF16->UTF32->UTF8.
        // See http://unicode.org/faq/utf_bom.html#utf16-3
        // For UTF8 byte structure, see http://en.wikipedia.org/wiki/UTF-8#Description and https://www.ietf.org/rfc/rfc2279.txt and https://tools.ietf.org/html/rfc3629
        var u = str.charCodeAt(i); // possibly a lead surrogate
        if (u >= 0xD800 && u <= 0xDFFF) {
            var u1 = str.charCodeAt(++i);
            u = 0x10000 + ((u & 0x3FF) << 10) | (u1 & 0x3FF);
        }
        if (u <= 0x7F) {
            if (outIdx >= endIdx) break;
            heap[outIdx++] = u;
        } else if (u <= 0x7FF) {
            if (outIdx + 1 >= endIdx) break;
            heap[outIdx++] = 0xC0 | (u >> 6);
            heap[outIdx++] = 0x80 | (u & 63);
        } else if (u <= 0xFFFF) {
            if (outIdx + 2 >= endIdx) break;
            heap[outIdx++] = 0xE0 | (u >> 12);
            heap[outIdx++] = 0x80 | ((u >> 6) & 63);
            heap[outIdx++] = 0x80 | (u & 63);
        } else {
            if (outIdx + 3 >= endIdx) break;

            if (u >= 0x200000) console.warn('Invalid Unicode code point 0x' + u.toString(16) + ' encountered when serializing a JS string to an UTF-8 string on the asm.js/wasm heap! (Valid unicode code points should be in range 0-0x1FFFFF).');

            heap[outIdx++] = 0xF0 | (u >> 18);
            heap[outIdx++] = 0x80 | ((u >> 12) & 63);
            heap[outIdx++] = 0x80 | ((u >> 6) & 63);
            heap[outIdx++] = 0x80 | (u & 63);
        }
    }
    return outIdx - startIdx;
}

var FS = {
    loaded_files: [],
    unique_id: 0
};

var wasm_exports = {
    crate_version: function() {
        return Module.ccall('crate_version', 'number', [], []);
    },
    allocate_vec_u8: function(len) {
        return Module.ccall('allocate_vec_u8', 'number', ['number'], [len]);
    },
    on_clipboard_paste: function(x, y) {
        return Module.ccall('on_clipboard_paste', 'null', ['number', 'number'], [x, y]);
    },
    frame: function() {
        return Module.ccall('frame', 'null', [], []);
    },
    mouse_move: function(x, y) {
        return Module.ccall('mouse_move', 'null', ['number', 'number'], [x, y]);
    },
    raw_mouse_move: function(x, y) {
        return Module.ccall('raw_mouse_move', 'null', ['number', 'number'], [x, y]);
    },
    mouse_down: function(x, y, b) {
        return Module.ccall('mouse_down', 'null', ['number', 'number', 'number'], [x, y, b]);
    },
    mouse_up: function(x, y, b) {
        return Module.ccall('mouse_up', 'null', ['number', 'number', 'number'], [x, y, b]);
    },
    mouse_wheel: function(x, y) {
        return Module.ccall('mouse_wheel', 'null', ['number', 'number'], [x, y]);
    },
    key_down: function(k, m, r) {
        return Module.ccall('key_down', 'null', ['number', 'number', 'boolean'], [k, m, r]);
    },
    key_press: function(k) {
        return Module.ccall('key_press', 'null', ['number'], [k]);
    },
    key_up: function(k, m) {
        return Module.ccall('key_up', 'null', ['number', 'number'], [k, m]);
    },
    resize: function(w, h) {
        return Module.ccall('resize', 'null', ['number', 'number'], [w, h]);
    },
    touch: function(p, id, x, y) {
        return Module.ccall('touch', 'null', ['number', 'number', 'number', 'number'], [p, id, x, y]);
    },
    focus: function(b) {
        return Module.ccall('focus', 'null', ['boolean'], [b]);
    },
    on_files_dropped_start: function() {
        return Module.ccall('on_files_dropped_start', 'null', [], []);
    },
    on_files_dropped_finish: function() {
        return Module.ccall('on_files_dropped_finish', 'null', [], []);
    },
    on_file_dropped: function(p, pl, b, bl) {
        return Module.ccall('on_file_dropped', 'null', ['number', 'number', 'number', 'number'], [p, pl, b, bl]);
    }
};

function dpi_scale(high_dpi) {
    if (high_dpi) {
        return window.devicePixelRatio || 1.0;
    } else {
        return 1.0;
    }
}

function resize(canvas, on_resize) {
    var dpr = dpi_scale();
    var displayWidth = canvas.clientWidth * dpr;
    var displayHeight = canvas.clientHeight * dpr;

    if (canvas.width != displayWidth ||
        canvas.height != displayHeight) {
        canvas.width = displayWidth;
        canvas.height = displayHeight;
        if (on_resize != undefined)
            on_resize(Math.floor(displayWidth), Math.floor(displayHeight))
    }
}

function animation() {
    wasm_exports.frame();
    if (!window.blocking_event_loop) {
        if (animation_frame_timeout) {
            window.cancelAnimationFrame(animation_frame_timeout);
        }
        animation_frame_timeout = window.requestAnimationFrame(animation);
    }
}

const SAPP_EVENTTYPE_TOUCHES_BEGAN = 10;
const SAPP_EVENTTYPE_TOUCHES_MOVED = 11;
const SAPP_EVENTTYPE_TOUCHES_ENDED = 12;
const SAPP_EVENTTYPE_TOUCHES_CANCELED = 13;

const SAPP_MODIFIER_SHIFT = 1;
const SAPP_MODIFIER_CTRL = 2;
const SAPP_MODIFIER_ALT = 4;
const SAPP_MODIFIER_SUPER = 8;

function into_sapp_mousebutton(btn) {
    switch (btn) {
        case 0: return 0;
        case 1: return 2;
        case 2: return 1;
        default: return btn;
    }
}

function into_sapp_keycode(key_code) {
    switch (key_code) {
        case "Space": return 32;
        case "Quote": return 222;
        case "Comma": return 44;
        case "Minus": return 45;
        case "Period": return 46;
        case "Slash": return 189;
        case "Digit0": return 48;
        case "Digit1": return 49;
        case "Digit2": return 50;
        case "Digit3": return 51;
        case "Digit4": return 52;
        case "Digit5": return 53;
        case "Digit6": return 54;
        case "Digit7": return 55;
        case "Digit8": return 56;
        case "Digit9": return 57;
        case "Semicolon": return 59;
        case "Equal": return 61;
        case "KeyA": return 65;
        case "KeyB": return 66;
        case "KeyC": return 67;
        case "KeyD": return 68;
        case "KeyE": return 69;
        case "KeyF": return 70;
        case "KeyG": return 71;
        case "KeyH": return 72;
        case "KeyI": return 73;
        case "KeyJ": return 74;
        case "KeyK": return 75;
        case "KeyL": return 76;
        case "KeyM": return 77;
        case "KeyN": return 78;
        case "KeyO": return 79;
        case "KeyP": return 80;
        case "KeyQ": return 81;
        case "KeyR": return 82;
        case "KeyS": return 83;
        case "KeyT": return 84;
        case "KeyU": return 85;
        case "KeyV": return 86;
        case "KeyW": return 87;
        case "KeyX": return 88;
        case "KeyY": return 89;
        case "KeyZ": return 90;
        case "BracketLeft": return 91;
        case "Backslash": return 92;
        case "BracketRight": return 93;
        case "Backquote": return 96;
        case "Escape": return 256;
        case "Enter": return 257;
        case "Tab": return 258;
        case "Backspace": return 259;
        case "Insert": return 260;
        case "Delete": return 261;
        case "ArrowRight": return 262;
        case "ArrowLeft": return 263;
        case "ArrowDown": return 264;
        case "ArrowUp": return 265;
        case "PageUp": return 266;
        case "PageDown": return 267;
        case "Home": return 268;
        case "End": return 269;
        case "CapsLock": return 280;
        case "ScrollLock": return 281;
        case "NumLock": return 282;
        case "PrintScreen": return 283;
        case "Pause": return 284;
        case "F1": return 290;
        case "F2": return 291;
        case "F3": return 292;
        case "F4": return 293;
        case "F5": return 294;
        case "F6": return 295;
        case "F7": return 296;
        case "F8": return 297;
        case "F9": return 298;
        case "F10": return 299;
        case "F11": return 300;
        case "F12": return 301;
        case "F13": return 302;
        case "F14": return 303;
        case "F15": return 304;
        case "F16": return 305;
        case "F17": return 306;
        case "F18": return 307;
        case "F19": return 308;
        case "F20": return 309;
        case "F21": return 310;
        case "F22": return 311;
        case "F23": return 312;
        case "F24": return 313;
        case "Numpad0": return 320;
        case "Numpad1": return 321;
        case "Numpad2": return 322;
        case "Numpad3": return 323;
        case "Numpad4": return 324;
        case "Numpad5": return 325;
        case "Numpad6": return 326;
        case "Numpad7": return 327;
        case "Numpad8": return 328;
        case "Numpad9": return 329;
        case "NumpadDecimal": return 330;
        case "NumpadDivide": return 331;
        case "NumpadMultiply": return 332;
        case "NumpadSubtract": return 333;
        case "NumpadAdd": return 334;
        case "NumpadEnter": return 335;
        case "NumpadEqual": return 336;
        case "ShiftLeft": return 340;
        case "ControlLeft": return 341;
        case "AltLeft": return 342;
        case "OSLeft": return 343;
        case "ShiftRight": return 344;
        case "ControlRight": return 345;
        case "AltRight": return 346;
        case "OSRight": return 347;
        case "ContextMenu": return 348;
    }

    console.log("Unsupported keyboard key: ", key_code)
}

function mouse_relative_position(clientX, clientY) {
    var targetRect = canvas.getBoundingClientRect();

    var x = (clientX - targetRect.left) * dpi_scale();
    var y = (clientY - targetRect.top) * dpi_scale();

    return { x, y };
}
