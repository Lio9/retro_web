package com.retroweb.api.save;

import java.io.InputStream;

/**
 * 存档 blob 存储抽象：P2 本地实现，后续可换 MinIO/S3
 */
public interface SaveBlobStore {

    /** 写入对象；返回 storageKey */
    String put(String storageKey, byte[] payload);

    /** 读取对象流 */
    InputStream open(String storageKey);

    /** 删除（可选清理） */
    void delete(String storageKey);
}
