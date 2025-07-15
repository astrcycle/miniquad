use core::ffi::{c_int, c_char};

#[repr(C)]
#[derive(Default)]
#[allow(non_snake_case)]
struct EmscriptenWebGLContextAttributes {
    alpha: bool,
    depth: bool,
    stencil: bool,
    antialias: bool,
    premultipliedAlpha: bool,
    preserveDrawingBuffer: bool,
    powerPreference: c_int,
    failIfMajorPerformanceCaveat: bool,

    majorVersion: c_int,
    minorVersion: c_int,

    enableExtensionsByDefault: bool,
    explicitSwapControl: bool,
    proxyContextToMainThread: c_int,
    renderViaOffscreenBackBuffer: bool,
}

unsafe extern "C" {
    fn emscripten_webgl_init_context_attributes(
        attributes: *mut EmscriptenWebGLContextAttributes
    );

    fn emscripten_webgl_create_context(
        target: *const c_char,
        attributes: *const EmscriptenWebGLContextAttributes
    ) -> u32;

    fn emscripten_webgl_make_context_current(context: u64) -> c_int;
}

pub fn init_webgl() {
    unsafe {
        let mut attrs = EmscriptenWebGLContextAttributes::default();
        emscripten_webgl_init_context_attributes(&mut attrs);
        attrs.alpha = false;
        attrs.depth = true;
        attrs.stencil = true;
        attrs.antialias = true;
        attrs.premultipliedAlpha = false;
        attrs.preserveDrawingBuffer = true;
        attrs.enableExtensionsByDefault = true;
        attrs.majorVersion = 2;
        let ctx = emscripten_webgl_create_context(c"#canvas".as_ptr(), &attrs);
        emscripten_webgl_make_context_current(ctx as u64);
    }
}
