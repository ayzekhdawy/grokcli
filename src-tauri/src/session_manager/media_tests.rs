//! Media path extract tests.
#![cfg(test)]

use super::*;

use serde_json::json;

#[test]
fn extracts_backtick_path_from_mcp_okay_output() {
    let raw = json!({
        "status": "completed",
        "rawOutput": {
            "type": "MCP",
            "tool_name": "image_edit",
            "server_name": "official-aux",
            "output": {
                "OkayOutput": "已完成 image_edit。\n\n**输出文件路径：**\n\n`/tmp/demo/images/1.jpg`\n\n（会话内相对路径：images/1.jpg）"
            }
        }
    });
    assert_eq!(
        extract_generated_media_path(&raw).as_deref(),
        Some("/tmp/demo/images/1.jpg")
    );
}

#[test]
fn extracts_path_from_content_text_markdown() {
    let raw = json!({
        "content": [{
            "type": "content",
            "content": {
                "type": "text",
                "text": "saved to /Users/me/out/pixel.png for you"
            }
        }]
    });
    assert_eq!(
        extract_generated_media_path(&raw).as_deref(),
        Some("/Users/me/out/pixel.png")
    );
}

#[test]
fn normalizes_chatcut_protocol_relative_s3_url() {
    let raw = "//chatcut-production-mainbucketbucket-oxvbnfsx.s3.us-east-1.amazonaws.com/users/u/projects/p/assets/image/id/%E7%AC%AC2-thumbnail.jpg";
    assert_eq!(
        normalize_media_ref(raw).as_deref(),
        Some(
            "https://chatcut-production-mainbucketbucket-oxvbnfsx.s3.us-east-1.amazonaws.com/users/u/projects/p/assets/image/id/%E7%AC%AC2-thumbnail.jpg"
        )
    );
    assert!(!is_local_media_fs_path(raw));
    assert!(is_media_fs_path(&normalize_media_ref(raw).unwrap()));
}

#[test]
fn rejects_frame_name_placeholder() {
    assert!(normalize_media_ref("/<frame-name>.jpg").is_none());
    assert!(!is_local_media_fs_path("/<frame-name>.jpg"));
    let text = "tool_step|completed|use_tool|chatcut__view_timeline_frames\n/<frame-name>.jpg";
    // Must not return the placeholder as a media path.
    let got = first_media_path_in_text(text);
    assert!(
        got.as_ref().map(|s| !s.contains('<')).unwrap_or(true),
        "unexpected {got:?}"
    );
}

#[test]
fn collapses_double_slash_in_temp_frame_path() {
    let raw = "/var/folders/75/xx/T//chatcut-frames.qVukfi/f2150.jpg";
    assert_eq!(
        normalize_media_ref(raw).as_deref(),
        Some("/var/folders/75/xx/T/chatcut-frames.qVukfi/f2150.jpg")
    );
    assert!(is_local_media_fs_path(raw));
}

#[test]
fn extracts_chatcut_s3_from_mcp_text() {
    let raw = json!({
        "status": "completed",
        "rawOutput": {
            "output": "thumbnail: //cdn.example.com/a/b/thumb.jpg\n"
        }
    });
    assert_eq!(
        extract_generated_media_path(&raw).as_deref(),
        Some("https://cdn.example.com/a/b/thumb.jpg")
    );
}

#[test]
fn does_not_false_extract_relative_md_image_as_root_abs() {
    // Markdown in chat backups: `![](media/img_001.png)` used to yield `/img_001.png`
    // because the bare-path scanner started at the mid-relative `/`.
    let text = "see ![](media/img_001.png) and more";
    assert!(
        first_media_path_in_text(text).is_none(),
        "unexpected {:?}",
        first_media_path_in_text(text)
    );
    assert!(!is_plausible_local_media_abs("/img_001.png"));
    assert!(is_plausible_local_media_abs(
        "/Users/me/chat/media/img_001.png"
    ));
}

#[test]
fn still_extracts_real_absolute_media_in_markdown() {
    let text = "saved ![](/Users/me/out/pixel.png) for you";
    assert_eq!(
        first_media_path_in_text(text).as_deref(),
        Some("/Users/me/out/pixel.png")
    );
}

#[test]
fn structured_prefers_raw_output_path_over_freeform() {
    let raw = json!({
        "rawOutput": {
            "path": "/tmp/demo/images/1.jpg",
            "output": "also see /Users/me/other.png"
        }
    });
    assert_eq!(
        extract_structured_media_path(&raw).as_deref(),
        Some("/tmp/demo/images/1.jpg")
    );
    assert_eq!(
        extract_generated_media_path(&raw).as_deref(),
        Some("/tmp/demo/images/1.jpg")
    );
}

#[test]
fn freeform_scans_okay_output_when_no_structured_path() {
    let raw = json!({
        "rawOutput": {
            "output": {
                "OkayOutput": "done: `/tmp/demo/images/2.png`"
            }
        }
    });
    assert!(extract_structured_media_path(&raw).is_none());
    assert_eq!(
        extract_freeform_media_path(&raw).as_deref(),
        Some("/tmp/demo/images/2.png")
    );
}

#[test]
fn terminal_output_urls_never_attach_freeform() {
    // A curl scrape of a homepage prints image URLs as incidental stdout.
    // The assistant message must not end up with an unrelated image card.
    let raw = json!({
        "status": "completed",
        "rawInput": {"command": "curl -s https://mixailab.com/ | grep -oE 'https?://[^\"' ]+\\.jpg'"},
        "rawOutput": {
            "output": "https://wanxiang-home-website-hz.oss-cn-hangzhou.aliyuncs.com/prod/frontend/public/images/community-experts/azhen-irene.jpg"
        }
    });
    assert!(!tool_is_media_capable(
        "run_terminal_command",
        "execute",
        "Execute",
        &raw
    ));
    // The gate runs before the scanner in events.rs; combined = no attach.
    let combined = if tool_is_media_capable("run_terminal_command", "execute", "Execute", &raw) {
        extract_freeform_media_path(&raw)
    } else {
        None
    };
    assert_eq!(combined, None);
}

#[test]
fn read_file_output_does_not_attach_freeform_media() {
    let raw = json!({
        "status": "completed",
        "rawOutput": {
            "output": "README says see https://cdn.example.com/a/b/logo.png for the logo"
        }
    });
    assert!(!tool_is_media_capable("read_file", "read", "Read", &raw));
    let combined = if tool_is_media_capable("read_file", "read", "Read", &raw) {
        extract_freeform_media_path(&raw)
    } else {
        None
    };
    assert_eq!(combined, None);
}

#[test]
fn web_fetch_and_mcp_stay_media_capable() {
    // Research fetches may legitimately carry relevant media refs (77d8c613
    // wan-3-0 cover came from a web_fetch og:image). ChatCut MCP plain-text
    // thumbs must keep attaching too.
    let web = json!({"rawOutput": {"output": "image: https://cdn.evolink.ai/models/wan-3-0/wan-3-0-release-cover-v2.webp"}});
    assert!(tool_is_media_capable(
        "web_fetch",
        "fetch",
        "Web Fetch",
        &web
    ));
    assert_eq!(
        extract_freeform_media_path(&web).as_deref(),
        Some("https://cdn.evolink.ai/models/wan-3-0/wan-3-0-release-cover-v2.webp")
    );

    let mcp = json!({
        "rawOutput": {
            "type": "MCP",
            "tool_name": "chatcut__create_project",
            "output": "thumbnail: //cdn.example.com/a/b/thumb.jpg\n"
        }
    });
    assert!(tool_is_media_capable(
        "chatcut__create_project",
        "use_tool",
        "Use Tool",
        &mcp
    ));
    assert_eq!(
        extract_freeform_media_path(&mcp).as_deref(),
        Some("https://cdn.example.com/a/b/thumb.jpg")
    );
}

#[test]
fn sparse_terminal_update_is_blocked_by_command_hint() {
    // Status-only terminal payload lost its identity; the command argument is
    // the terminal signal that must still gate freeform scanning.
    let raw = json!({
        "status": "completed",
        "rawInput": {"command": "find /Users/me -name '*.jpg' | head"},
        "rawOutput": {"output": "/Users/me/out/photo.jpg"}
    });
    assert!(!tool_is_media_capable("", "tool", "Tool", &raw));
    let combined = if tool_is_media_capable("", "tool", "Tool", &raw) {
        extract_freeform_media_path(&raw)
    } else {
        None
    };
    assert_eq!(combined, None);
}

#[test]
fn prepare_rejects_missing_and_single_segment() {
    assert!(prepare_media_attachment_path("/img_001.png", None, true).is_none());
    assert!(
        prepare_media_attachment_path("/no/such/path/definitely-missing-xyz.png", None, true)
            .is_none()
    );
    // Remote always ok without disk.
    assert_eq!(
        prepare_media_attachment_path("https://cdn.example.com/a/b/thumb.jpg", None, false)
            .as_deref(),
        Some("https://cdn.example.com/a/b/thumb.jpg")
    );
}

#[test]
fn read_file_path_hint_does_not_attach_granted_image() {
    // Session 14cca5e6: read_file of the user-attached 三视图 was path_hint
    // attached onto the assistant (soft, because composer had granted it).
    // That painted a leftover ImageUi that 403'd outside the project root.
    let dir = std::env::temp_dir().join(format!("grok-read-echo-{}", std::process::id()));
    let _ = std::fs::create_dir_all(&dir);
    let file = dir.join("IP shot.png");
    std::fs::write(&file, b"fake-png").expect("write");
    let path = file.to_string_lossy().to_string();
    crate::path_scope::grant_path(std::path::Path::new(&path));
    let raw = json!({
        "status": "completed",
        "title": format!("Read `{path}`"),
        "rawInput": { "target_file": path },
        "locations": [{ "path": path }],
    });
    assert!(!tool_is_media_capable("read_file", "read", "Read", &raw));
    assert_eq!(
        completed_tool_media_attachment(&raw, "read_file", "read", "Read", None, "completed"),
        None
    );
    let _ = std::fs::remove_file(&file);
    let _ = std::fs::remove_dir(&dir);
}

#[test]
fn image_edit_structured_path_still_attaches() {
    let dir = std::env::temp_dir().join(format!("grok-edit-att-{}", std::process::id()));
    let _ = std::fs::create_dir_all(&dir);
    let file = dir.join("1.jpg");
    std::fs::write(&file, b"fake-jpg").expect("write");
    let path = file.to_string_lossy().to_string();
    let raw = json!({
        "status": "completed",
        "rawOutput": { "path": path },
    });
    assert_eq!(
        completed_tool_media_attachment(
            &raw,
            "image_edit",
            "other",
            "imagine-edit",
            None,
            "completed"
        )
        .as_deref(),
        Some(path.as_str())
    );
    let _ = std::fs::remove_file(&file);
    let _ = std::fs::remove_dir(&dir);
}

#[test]
fn prepare_force_grants_existing_temp_media() {
    let dir = std::env::temp_dir().join(format!("grok-media-attach-test-{}", std::process::id()));
    let _ = std::fs::create_dir_all(&dir);
    let file = dir.join("shot.png");
    std::fs::write(&file, b"fake").expect("write");
    let path = file.to_string_lossy().to_string();
    let out = prepare_media_attachment_path(&path, None, true);
    assert_eq!(out.as_deref(), Some(path.as_str()));
    assert!(crate::path_scope::is_allowed(std::path::Path::new(&path)));
    let _ = std::fs::remove_file(&file);
    let _ = std::fs::remove_dir(&dir);
}
