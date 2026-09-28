package com.retroweb.api.save;

import org.springframework.core.io.InputStreamResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.io.InputStream;
import java.util.List;

/**
 * 存档同步 API
 *
 * GET    /api/saves                      元数据列表
 * GET    /api/saves/{gameId}/blob        下载 .sav（ETag + X-Save-Revision）
 * PUT    /api/saves/{gameId}/blob        上传（If-Match: clientRevision）
 * GET    /api/saves/{gameId}/meta        单条元数据
 */
@RestController
@RequestMapping("/api/saves")
public class SaveSyncController {

    private final SaveSyncService saveSyncService;

    public SaveSyncController(SaveSyncService saveSyncService) {
        this.saveSyncService = saveSyncService;
    }

    @GetMapping
    public List<SaveDtos.SaveMetaDto> list(Authentication auth) {
        return saveSyncService.listSaves(userId(auth));
    }

    @GetMapping("/{gameId}/meta")
    public SaveDtos.SaveMetaDto meta(@PathVariable String gameId, Authentication auth) {
        try {
            return saveSyncService.getMeta(userId(auth), gameId);
        } catch (IllegalArgumentException ex) {
            return notFoundBody(gameId);
        }
    }

    @GetMapping("/{gameId}/blob")
    public ResponseEntity<InputStreamResource> download(
            @PathVariable String gameId,
            @RequestHeader(value = HttpHeaders.IF_NONE_MATCH, required = false) String ifNoneMatch,
            Authentication auth) {
        SaveSyncService.SaveBlob blob;
        try {
            blob = saveSyncService.openBlob(userId(auth), gameId);
        } catch (IllegalArgumentException ex) {
            return ResponseEntity.notFound().build();
        }

        String etag = "\"" + blob.revision() + "\"";
        if (etag.equals(ifNoneMatch)) {
            return ResponseEntity.status(HttpStatus.NOT_MODIFIED).eTag(etag).build();
        }

        InputStream stream = blob.stream();
        return ResponseEntity.ok()
                .eTag(etag)
                .header("X-Save-Revision", String.valueOf(blob.revision()))
                .header("X-Save-UpdatedAt", String.valueOf(blob.updatedAt()))
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"game.sav\"")
                .body(new InputStreamResource(stream));
    }

    /**
     * 上传存档。
     * If-Match 必填，值为客户端当前 revision（无存档时传 0）。
     * 冲突返回 409 + X-Server-Revision。
     */
    @PutMapping("/{gameId}/blob")
    public ResponseEntity<?> upload(
            @PathVariable String gameId,
            @RequestHeader(HttpHeaders.IF_MATCH) long clientRevision,
            @RequestBody byte[] payload,
            Authentication auth) {
        try {
            SaveDtos.SaveMetaDto meta = saveSyncService.save(userId(auth), gameId, clientRevision, payload);
            return ResponseEntity.ok()
                    .eTag("\"" + meta.getRevision() + "\"")
                    .header("X-Save-Revision", String.valueOf(meta.getRevision()))
                    .body(meta);
        } catch (RevisionConflictException ex) {
            SaveDtos.ConflictBody body = SaveDtos.ConflictBody.builder()
                    .serverRevision(ex.getServerRevision())
                    .message("revision conflict")
                    .build();
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .header("X-Server-Revision", String.valueOf(ex.getServerRevision()))
                    .body(body);
        } catch (IllegalArgumentException ex) {
            return ResponseEntity.badRequest().body(ex.getMessage());
        }
    }

    private static String userId(Authentication auth) {
        // JwtAuthFilter 把 userId 放在 principal
        return String.valueOf(auth.getPrincipal());
    }

    private SaveDtos.SaveMetaDto notFoundBody(String gameId) {
        // 简化：未找到时抛 404 更合适；骨架保留 meta 查询统一类型
        throw new org.springframework.web.server.ResponseStatusException(
                HttpStatus.NOT_FOUND, "save not found: " + gameId);
    }
}
