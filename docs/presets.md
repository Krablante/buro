# Presets

A preset is declarative YAML loaded through `BURO_SCHEMA_PATH` or `schema_path`. It defines one id, version, default kind, context relationship, finite kinds, finite fields, and field sets.

The engine supports string, text, boolean, integer, number, reference, string-list, record, and record-list fields. A reference may declare `target_kind`. A record declares finite nested fields.

Preset files cannot execute code, SQL, hooks, processors, plugins, or templates. Invalid definitions fail at load time. Entity data is validated again whenever it is read or written, so changing the active preset cannot silently reinterpret incompatible data.

The bundled Politia preset contains structure only. Instance ids, paths, repositories, network data, identities, and operating facts belong exclusively in SQLite.
