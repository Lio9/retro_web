package com.retroweb.api.save;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.InputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;

/**
 * 存档同步服务：乐观锁 revision
 *
 * 关键逻辑：
 *  1) 客户端上传时携带自己认为的 clientRevision（If-Match）
 *  2) 若服务端 revision 不一致 → RevisionConflictException（HTTP 409）
 *  3) 成功则 revision+1，写入 blob，更新元数据
 */
@Service
public class SaveSyncService {

    public static final int MAX_SAVE_BYTES = 8 * 1024 * 1024; // 8MB 上限，防止打爆存储

    private final SaveMetaRepository metaRepo;
    private final SaveBlobStore blobStore;

    public SaveSyncService(SaveMetaRepository metaRepo, SaveBlobStore blobStore) {
        this.metaRepo = metaRepo;
        this.blobStore = blobStore;
    }

    public List<SaveDtos.SaveMetaDto> listSaves(String userId) {
        return metaRepo.findByUserIdOrderByUpdatedAtDesc(userId).stream()
                .map(SaveDtos.SaveMetaDto::from)
                .toList();
    }

    @Transactional
    public SaveDtos.SaveMetaDto save(String userId, String gameId, long clientRevision, byte[] payload) {
        if (payload == null || payload.length == 0) {
            throw new IllegalArgumentException("empty save payload");
        }
        if (payload.length > MAX_SAVE_BYTES) {
            throw new IllegalArgumentException("save too large");
        }

        SaveMeta meta = metaRepo.findByUserIdAndGameId(userId, gameId)
                .orElseGet(() -> SaveMeta.builder()
                        .userId(userId)
                        .gameId(gameId)
                        .revision(0L)
                        .byteSize(0)
                        .sha256("")
                        .storageKey("pending")
                        .build());

        // 关键：乐观锁检查，防止多端互相覆盖
        if (!meta.getRevision().equals(clientRevision)) {
            throw new RevisionConflictException(meta.getRevision());
        }

        long next = meta.getRevision() + 1L;
        String storageKey = "saves/%s/%s/%d.sav".formatted(userId, gameId, next);
        blobStore.put(storageKey, payload);

        meta.setRevision(next);
        meta.setByteSize(payload.length);
        meta.setSha256(sha256Hex(payload));
        meta.setStorageKey(storageKey);
        metaRepo.save(meta);
        return SaveDtos.SaveMetaDto.from(meta);
    }

    public SaveBlob openBlob(String userId, String gameId) {
        SaveMeta meta = metaRepo.findByUserIdAndGameId(userId, gameId)
                .orElseThrow(() -> new IllegalArgumentException("save not found"));
        return new SaveBlob(meta.getRevision(), meta.getUpdatedAt(), blobStore.open(meta.getStorageKey()));
    }

    public SaveDtos.SaveMetaDto getMeta(String userId, String gameId) {
        return metaRepo.findByUserIdAndGameId(userId, gameId)
                .map(SaveDtos.SaveMetaDto::from)
                .orElseThrow(() -> new IllegalArgumentException("save not found"));
    }

    /** blob + 元数据，便于 Controller 返回 ETag */
    public record SaveBlob(long revision, java.time.Instant updatedAt, InputStream stream) {}

    private static String sha256Hex(byte[] data) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(md.digest(data));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
