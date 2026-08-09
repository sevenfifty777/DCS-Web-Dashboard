//! Render typed protobuf messages to JSON matching the legacy Node backend.
//!
//! The original Next.js dashboard decoded gRPC responses with
//! `@grpc/proto-loader` configured
//! `{ keepCase: true, longs: String, enums: String, defaults: true, oneofs: true }`.
//! The browser and Android consumers depend on that exact wire shape:
//!
//! * snake_case field names (NOT camelCase),
//! * enum values as their UPPER_SNAKE string names (e.g. `COALITION_RED`,
//!   `GROUP_CATEGORY_AIRPLANE`),
//! * 64-bit integers serialized as strings,
//! * default scalar fields included,
//! * each `oneof` carries a virtual discriminator field (named after the
//!   oneof) whose value is the set variant's field name, alongside the variant
//!   payload itself — e.g. `{ "update": "unit", "unit": { … } }`.
//!
//! We reproduce this with `prost-reflect`: the typed message is transcoded into
//! a [`DynamicMessage`] and serialized with proto JSON field names + defaults
//! (which already yields snake_case names, enum strings, and 64-bit-as-string),
//! then we walk the message to inject the oneof discriminators that canonical
//! proto JSON omits.

use std::sync::OnceLock;

use anyhow::{Context, Result};
use prost_reflect::{
    DescriptorPool, DynamicMessage, MessageDescriptor, ReflectMessage, SerializeOptions,
};
use serde_json::Value;

/// Lazily-built reflection pool over the compiled DCS protos.
fn pool() -> &'static DescriptorPool {
    static POOL: OnceLock<DescriptorPool> = OnceLock::new();
    POOL.get_or_init(|| {
        DescriptorPool::decode(crate::pb::FILE_DESCRIPTOR_SET)
            .expect("embedded proto descriptor set must decode")
    })
}

/// Serialize a typed protobuf message as proto-loader-compatible JSON.
///
/// `full_name` is the fully-qualified message type, e.g.
/// `dcs.mission.v0.StreamUnitsResponse`.
pub fn to_sse_json<M: prost::Message>(msg: &M, full_name: &str) -> Result<String> {
    let descriptor: MessageDescriptor = pool()
        .get_message_by_name(full_name)
        .with_context(|| format!("unknown message type {full_name}"))?;

    // Round-trip the typed message through its wire bytes into a reflective
    // `DynamicMessage`. The encodings are wire-compatible across the two prost
    // versions (generated stubs vs. prost-reflect's bundled prost).
    let bytes = msg.encode_to_vec();
    let dynamic = DynamicMessage::decode(descriptor, bytes.as_slice())
        .with_context(|| format!("failed to decode {full_name} for reflection"))?;

    // proto-loader: keepCase + defaults: true. (64-bit ints already stringify by
    // default in prost-reflect, matching `longs: String`.)
    let options = SerializeOptions::new()
        .use_proto_field_name(true)
        .skip_default_fields(false);

    let mut value = dynamic
        .serialize_with_options(serde_json::value::Serializer, &options)
        .context("failed to serialize dynamic message")?;

    inject_oneof_discriminators(&dynamic, &mut value);

    serde_json::to_string(&value).context("failed to stringify JSON value")
}

/// Recursively add the proto-loader `oneofs: true` virtual discriminator
/// fields.
///
/// Canonical proto JSON emits only the set variant (`"unit": { … }`);
/// proto-loader additionally emits `"<oneof>": "<variant>"`. Synthetic oneofs
/// generated for proto3 `optional` fields (always exactly one member) are
/// skipped so they do not produce spurious discriminators.
fn inject_oneof_discriminators(msg: &DynamicMessage, value: &mut Value) {
    let descriptor = msg.descriptor();

    // Well-known types (google.protobuf.Struct/Value/Timestamp/…) serialize to
    // canonical JSON whose shape no longer mirrors their message fields, so we
    // must not recurse into them.
    if descriptor.full_name().starts_with("google.protobuf.") {
        return;
    }

    let Value::Object(map) = value else {
        return;
    };

    for oneof in descriptor.oneofs() {
        // Real oneofs have more than one variant; single-member oneofs are the
        // synthetic wrappers protoc emits for proto3 `optional`.
        if oneof.fields().count() <= 1 {
            continue;
        }
        if let Some(field) = oneof.fields().find(|f| msg.has_field(f)) {
            map.insert(
                oneof.name().to_string(),
                Value::String(field.name().to_string()),
            );
        }
    }

    // Recurse into nested messages and repeated-message fields so their oneofs
    // (e.g. an event payload nested under StreamEventsResponse) are handled too.
    for field in descriptor.fields() {
        let Some(child) = map.get_mut(field.name()) else {
            continue;
        };
        let field_value = msg.get_field(&field);
        if let Some(child_msg) = field_value.as_message() {
            inject_oneof_discriminators(child_msg, child);
        } else if let Some(list) = field_value.as_list() {
            if let Value::Array(items) = child {
                for (element, element_json) in list.iter().zip(items.iter_mut()) {
                    if let Some(element_msg) = element.as_message() {
                        inject_oneof_discriminators(element_msg, element_json);
                    }
                }
            }
        }
    }
}
