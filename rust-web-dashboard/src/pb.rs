//! Generated gRPC client stubs for the DCS-gRPC API.
//!
//! The module tree mirrors the protobuf package hierarchy (`dcs.<area>.v0`) so
//! that cross-package type references resolve correctly.
#![allow(clippy::all)]
#![allow(rustdoc::all)]
#![allow(dead_code)]

/// Serialized `FileDescriptorSet` for the compiled DCS protos, emitted by
/// `build.rs`. Used by [`crate::proto_json`] to build a runtime reflection pool
/// (`prost-reflect`) for proto-loader-compatible JSON serialization.
pub const FILE_DESCRIPTOR_SET: &[u8] =
    include_bytes!(concat!(env!("OUT_DIR"), "/dcs_descriptor.bin"));

pub mod dcs {
    pub mod atmosphere {
        pub mod v0 {
            tonic::include_proto!("dcs.atmosphere.v0");
        }
    }
    pub mod coalition {
        pub mod v0 {
            tonic::include_proto!("dcs.coalition.v0");
        }
    }
    pub mod common {
        pub mod v0 {
            tonic::include_proto!("dcs.common.v0");
        }
    }
    pub mod common {
        pub mod v0 {
            tonic::include_proto!("dcs.common.v0");
        }
    }
    pub mod controller {
        pub mod v0 {
            tonic::include_proto!("dcs.controller.v0");
        }
    }
    pub mod custom {
        pub mod v0 {
            tonic::include_proto!("dcs.custom.v0");
        }
    }
    pub mod group {
        pub mod v0 {
            tonic::include_proto!("dcs.group.v0");
        }
    }
    pub mod hook {
        pub mod v0 {
            tonic::include_proto!("dcs.hook.v0");
        }
    }
    pub mod metadata {
        pub mod v0 {
            tonic::include_proto!("dcs.metadata.v0");
        }
    }
    pub mod mission {
        pub mod v0 {
            tonic::include_proto!("dcs.mission.v0");
        }
    }
    pub mod net {
        pub mod v0 {
            tonic::include_proto!("dcs.net.v0");
        }
    }
    pub mod srs {
        pub mod v0 {
            tonic::include_proto!("dcs.srs.v0");
        }
    }
    pub mod timer {
        pub mod v0 {
            tonic::include_proto!("dcs.timer.v0");
        }
    }
    pub mod trigger {
        pub mod v0 {
            tonic::include_proto!("dcs.trigger.v0");
        }
    }
    pub mod unit {
        pub mod v0 {
            tonic::include_proto!("dcs.unit.v0");
        }
    }
    pub mod world {
        pub mod v0 {
            tonic::include_proto!("dcs.world.v0");
        }
    }
    pub mod spot {
        pub mod v0 {
            tonic::include_proto!("dcs.spot.v0");
        }
    }
    pub mod warehouse {
        pub mod v0 {
            tonic::include_proto!("dcs.warehouse.v0");
        }
    }
}
