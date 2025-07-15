mergeInto(LibraryManager.library, {
    console_debug: function (ptr) {
        console.debug(UTF8ToString(ptr));
    },
    console_log: function (ptr) {
        console.log(UTF8ToString(ptr));
    },
    console_info: function (ptr) {
        console.info(UTF8ToString(ptr));
    },
    console_warn: function (ptr) {
        console.warn(UTF8ToString(ptr));
    },
    console_error: function (ptr) {
        console.error(UTF8ToString(ptr));
    },
    set_emscripten_shader_hack: function (flag) {
        emscripten_shaders_hack = flag;
    },
    sapp_set_clipboard: function (ptr, len) {
        clipboard = UTF8ToString(ptr, len);
    },
    dpi_scale: function (high_dpi) {
        dpi_scale(high_dpi);
    },
    rand: function () {
        return Math.floor(Math.random() * 2147483647);
    },
    now: function () {
        return Date.now() / 1000.0;
    },
    canvas_width: function () {
        return Math.floor(canvas.width);
    },
    canvas_height: function () {
        return Math.floor(canvas.height);
    },
    setup_canvas_size: function (high_dpi) {
        window.high_dpi = high_dpi;
        resize(canvas);
    },
    run_animation_loop: function (blocking) {
        canvas.onmousemove = function (event) {
            var relative_position = mouse_relative_position(event.clientX, event.clientY);
            var x = relative_position.x;
            var y = relative_position.y;

            // TODO: do not send mouse_move when cursor is captured
            wasm_exports.mouse_move(Math.floor(x), Math.floor(y));

            // TODO: check that mouse is captured?
            if (event.movementX != 0 || event.movementY != 0) {
                wasm_exports.raw_mouse_move(Math.floor(event.movementX), Math.floor(event.movementY));
            }
        };
        canvas.onmousedown = function (event) {
            var relative_position = mouse_relative_position(event.clientX, event.clientY);
            var x = relative_position.x;
            var y = relative_position.y;

            var btn = into_sapp_mousebutton(event.button);
            wasm_exports.mouse_down(x, y, btn);
        };
        // SO WEB SO CONSISTENT
        canvas.addEventListener('wheel',
            function (event) {
                event.preventDefault();
                wasm_exports.mouse_wheel(-event.deltaX, -event.deltaY);
            });
        canvas.onmouseup = function (event) {
            var relative_position = mouse_relative_position(event.clientX, event.clientY);
            var x = relative_position.x;
            var y = relative_position.y;

            var btn = into_sapp_mousebutton(event.button);
            wasm_exports.mouse_up(x, y, btn);
        };
        canvas.onkeydown = function (event) {
            var sapp_key_code = into_sapp_keycode(event.code);
            switch (sapp_key_code) {
                //  space, arrows - prevent scrolling of the page
                case 32: case 262: case 263: case 264: case 265:
                // F1-F10
                case 290: case 291: case 292: case 293: case 294: case 295: case 296: case 297: case 298: case 299:
                // backspace is Back on Firefox/Windows
                case 259:
                // tab - for UI
                case 258:
                // quote and slash are Quick Find on Firefox
                case 39: case 47:
                    event.preventDefault();
                    break;
            }

            var modifiers = 0;
            if (event.ctrlKey) {
                modifiers |= SAPP_MODIFIER_CTRL;
            }
            if (event.shiftKey) {
                modifiers |= SAPP_MODIFIER_SHIFT;
            }
            if (event.altKey) {
                modifiers |= SAPP_MODIFIER_ALT;
            }
            wasm_exports.key_down(sapp_key_code, modifiers, event.repeat);
            // for "space", "quote", and "slash" preventDefault will prevent
            // key_press event, so send it here instead
            if (sapp_key_code == 32 || sapp_key_code == 39 || sapp_key_code == 47) {
                wasm_exports.key_press(sapp_key_code);
            }
        };
        canvas.onkeyup = function (event) {
            var sapp_key_code = into_sapp_keycode(event.code);

            var modifiers = 0;
            if (event.ctrlKey) {
                modifiers |= SAPP_MODIFIER_CTRL;
            }
            if (event.shiftKey) {
                modifiers |= SAPP_MODIFIER_SHIFT;
            }
            if (event.altKey) {
                modifiers |= SAPP_MODIFIER_ALT;
            }

            wasm_exports.key_up(sapp_key_code, modifiers);
        };
        canvas.onkeypress = function (event) {
            var sapp_key_code = into_sapp_keycode(event.code);

            // firefox do not send onkeypress events for ctrl+keys and delete key while chrome do
            // workaround to make this behavior consistent
            let chrome_only = sapp_key_code == 261 || event.ctrlKey;
            if (chrome_only == false) {
                wasm_exports.key_press(event.charCode);
            }
        };

        canvas.addEventListener("touchstart", function (event) {
            event.preventDefault();

            for (const touch of event.changedTouches) {
                let relative_position = mouse_relative_position(touch.clientX, touch.clientY);
                wasm_exports.touch(SAPP_EVENTTYPE_TOUCHES_BEGAN, touch.identifier, relative_position.x, relative_position.y);
            }
        });
        canvas.addEventListener("touchend", function (event) {
            event.preventDefault();

            for (const touch of event.changedTouches) {
                let relative_position = mouse_relative_position(touch.clientX, touch.clientY);
                wasm_exports.touch(SAPP_EVENTTYPE_TOUCHES_ENDED, touch.identifier, relative_position.x, relative_position.y);
            }
        });
        canvas.addEventListener("touchcancel", function (event) {
            event.preventDefault();

            for (const touch of event.changedTouches) {
                let relative_position = mouse_relative_position(touch.clientX, touch.clientY);
                wasm_exports.touch(SAPP_EVENTTYPE_TOUCHES_CANCELED, touch.identifier, relative_position.x, relative_position.y);
            }
        });
        canvas.addEventListener("touchmove", function (event) {
            event.preventDefault();

            for (const touch of event.changedTouches) {
                let relative_position = mouse_relative_position(touch.clientX, touch.clientY);
                wasm_exports.touch(SAPP_EVENTTYPE_TOUCHES_MOVED, touch.identifier, relative_position.x, relative_position.y);
            }
        });

        window.onresize = function () {
            resize(canvas, wasm_exports.resize);
        };
        window.addEventListener("copy", function (e) {
            if (clipboard != null) {
                event.clipboardData.setData('text/plain', clipboard);
                event.preventDefault();
            }
        });
        window.addEventListener("cut", function (e) {
            if (clipboard != null) {
                event.clipboardData.setData('text/plain', clipboard);
                event.preventDefault();
            }
        });

        window.addEventListener("paste", function (e) {
            e.stopPropagation();
            e.preventDefault();
            var clipboardData = e.clipboardData || window.clipboardData;
            var pastedData = clipboardData.getData('Text');

            if (pastedData != undefined && pastedData != null && pastedData.length != 0) {
                var len = (new TextEncoder().encode(pastedData)).length;
                var msg = wasm_exports.allocate_vec_u8(len);
                var heap = new Uint8Array(wasm_memory.buffer, msg, len);
                stringToUTF8(pastedData, heap, 0, len);
                wasm_exports.on_clipboard_paste(msg, len);
            }
        });

        window.ondragover = function (e) {
            e.preventDefault();
        };

        window.ondrop = async function (e) {
            e.preventDefault();

            wasm_exports.on_files_dropped_start();

            for (let file of e.dataTransfer.files) {
                const nameLen = file.name.length;
                const nameVec = wasm_exports.allocate_vec_u8(nameLen);
                const nameHeap = new Uint8Array(wasm_memory.buffer, nameVec, nameLen);
                stringToUTF8(file.name, nameHeap, 0, nameLen);

                const fileBuf = await file.arrayBuffer();
                const fileLen = fileBuf.byteLength;
                const fileVec = wasm_exports.allocate_vec_u8(fileLen);
                const fileHeap = new Uint8Array(wasm_memory.buffer, fileVec, fileLen);
                fileHeap.set(new Uint8Array(fileBuf), 0);

                wasm_exports.on_file_dropped(nameVec, nameLen, fileVec, fileLen);
            }

            wasm_exports.on_files_dropped_finish();
        };

        let lastFocus = document.hasFocus();
        var checkFocus = function () {
            // The element doesn't loose focus when the user switches tabs.
            // However, the document becomes invisible
            let hasFocus = document.hasFocus() && document.visibilityState == "visible";
            if (lastFocus != hasFocus) {
                wasm_exports.focus(hasFocus);
                lastFocus = hasFocus;
            }
        }
        document.addEventListener("visibilitychange", checkFocus);
        window.addEventListener("focus", checkFocus);
        window.addEventListener("blur", checkFocus);

        window.blocking_event_loop = blocking;
        window.requestAnimationFrame(animation);
    },

    fs_load_file: function (ptr, len) {
        var url = UTF8ToString(ptr, len);
        var file_id = FS.unique_id;
        FS.unique_id += 1;
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.responseType = 'arraybuffer';

        xhr.onreadystatechange = function () {
            // looks like readyState === 4 will be fired on either successful or unsuccessful load:
            // https://stackoverflow.com/a/19247992
            if (this.readyState === 4) {
                if (this.status === 200) {
                    var uInt8Array = new Uint8Array(this.response);

                    FS.loaded_files[file_id] = uInt8Array;
                    wasm_exports.file_loaded(file_id);
                } else {
                    FS.loaded_files[file_id] = null;
                    wasm_exports.file_loaded(file_id);
                }
            }
        };
        xhr.send();

        return file_id;
    },

    fs_get_buffer_size: function (file_id) {
        if (FS.loaded_files[file_id] == null) {
            return -1;
        } else {
            return FS.loaded_files[file_id].length;
        }
    },
    fs_take_buffer: function (file_id, ptr, max_length) {
        var file = FS.loaded_files[file_id];
        console.assert(file.length <= max_length);
        var dest = new Uint8Array(wasm_memory.buffer, ptr, max_length);
        for (var i = 0; i < file.length; i++) {
            dest[i] = file[i];
        }
        delete FS.loaded_files[file_id];
    },
    sapp_set_cursor_grab: function (grab) {
        if (grab) {
            canvas.requestPointerLock();
        } else {
            document.exitPointerLock();
        }
    },
    sapp_set_cursor: function (ptr, len) {
        canvas.style.cursor = UTF8ToString(ptr, len);
    },
    sapp_is_fullscreen: function () {
        let fullscreenElement = document.fullscreenElement;

        return fullscreenElement != null && fullscreenElement.id == canvas.id;
    },
    sapp_set_fullscreen: function (fullscreen) {
        if (!fullscreen) {
            document.exitFullscreen();
        } else {
            canvas.requestFullscreen();
        }
    },
    sapp_set_window_size: function (new_width, new_height) {
        canvas.width = new_width;
        canvas.height = new_height;
        resize(canvas, wasm_exports.resize);
    },
    sapp_schedule_update: function () {
        if (animation_frame_timeout) {
            window.cancelAnimationFrame(animation_frame_timeout);
        }
        animation_frame_timeout = window.requestAnimationFrame(animation);
    }
});
