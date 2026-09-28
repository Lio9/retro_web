package com.retroweb.api.save;

import jakarta.persistence.*;
import lombok.*;

import java.time.Instant;

/**
 * 存档元数据：版本号 revision 用于乐观锁冲突检测
 */
@Entity
@Table(name = "save_meta",
       uniqueConstraints = @UniqueConstraint(columnNames = {"user_id", "game_id"}))
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class SaveMeta {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false, length = 64)
    private String userId;

    /** 前端计算的稳定游戏标识（如 ROM SHA-256） */
    @Column(name = "game_id", nullable = false, length = 128)
    private String gameId;

    /** 乐观锁版本：每次成功上传 +1 */
    @Column(nullable = false)
    @Builder.Default
    private Long revision = 0L;

    @Column(name = "byte_size", nullable = false)
    private Integer byteSize;

    @Column(nullable = false, length = 64)
    private String sha256;

    /** 对象存储或本地磁盘 key */
    @Column(name = "storage_key", nullable = false, length = 255)
    private String storageKey;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @PrePersist
    @PreUpdate
    void touch() {
        if (updatedAt == null) {
            updatedAt = Instant.now();
        }
    }
}
