//! Build script: compile the DCS-gRPC protobuf definitions into tonic client stubs.
//!
//! We vendor the `protos/` tree (copied from the DCS-gRPC server) so this crate
//! builds standalone. `protoc-bundled` provides a pinned `protoc` so no system
//! protobuf compiler is required.
//!
//! NOTE: serde derives are NOT emitted on the generated types. Streamed
//! messages are instead rendered to proto-loader-compatible JSON at runtime via
//! `prost-reflect`, which needs the serialized `FileDescriptorSet` written
//! below (`dcs_descriptor.bin`).

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // SAFETY: single-threaded build script; setting env for the bundled protoc.
    unsafe {
        std::env::set_var("PROTOC", protoc_bundled::PROTOC);
        std::env::set_var("PROTOC_INCLUDE", protoc_bundled::PROTOC_INCLUDE);
    }

    println!("cargo:rerun-if-changed=protos/dcs");

    let descriptor_path =
        std::path::PathBuf::from(std::env::var("OUT_DIR")?).join("dcs_descriptor.bin");

    tonic_build::configure()
        .build_server(false)
        .build_client(true)
        .file_descriptor_set_path(&descriptor_path)
        .compile_protos(&["protos/dcs/dcs.proto"], &["protos"])?;

    Ok(())
}
