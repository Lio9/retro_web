package com.retroweb.api.save;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.*;
import java.nio.file.*;

/**
 * 本地磁盘 blob 存储（开发/小规模生产可用）
 * 生产可替换为 MinIO 实现同一接口
 */
@Component
public class LocalSaveBlobStore implements SaveBlobStore {

    private final Path root;

    public LocalSaveBlobStore(@Value("${app.save.storage-dir:./data/saves}") String storageDir) {
        this.root = Paths.get(storageDir).toAbsolutePath().normalize();
        try {
            Files.createDirectories(root);
        } catch (IOException e) {
            throw new IllegalStateException("cannot create save storage dir: " + root, e);
        }
    }

    @Override
    public String put(String storageKey, byte[] payload) {
        Path target = resolveSafe(storageKey);
        try {
            Files.createDirectories(target.getParent());
            // 先写临时文件再原子移动，避免半份写入
            Path tmp = target.resolveSibling(target.getFileName() + ".tmp");
            Files.write(tmp, payload);
            Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            return storageKey;
        } catch (IOException e) {
            throw new IllegalStateException("save blob write failed: " + storageKey, e);
        }
    }

    @Override
    public InputStream open(String storageKey) {
        Path target = resolveSafe(storageKey);
        try {
            return Files.newInputStream(target);
        } catch (IOException e) {
            throw new IllegalStateException("save blob read failed: " + storageKey, e);
        }
    }

    @Override
    public void delete(String storageKey) {
        try {
            Files.deleteIfExists(resolveSafe(storageKey));
        } catch (IOException e) {
            throw new IllegalStateException("save blob delete failed: " + storageKey, e);
        }
    }

    /** 防止路径穿越 */
    private Path resolveSafe(String storageKey) {
        Path p = root.resolve(storageKey).normalize();
        if (!p.startsWith(root)) {
            throw new IllegalArgumentException("illegal storage key");
        }
        return p;
    }
}
