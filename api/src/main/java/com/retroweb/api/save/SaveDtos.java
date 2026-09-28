package com.retroweb.api.save;

import lombok.Builder;
import lombok.Value;

import java.time.Instant;

/**
 * 存档 API DTO
 */
public class SaveDtos {

    @Value
    @Builder
    public static class SaveMetaDto {
        String gameId;
        long revision;
        int size;
        String sha256;
        Instant updatedAt;

        public static SaveMetaDto from(SaveMeta m) {
            return SaveMetaDto.builder()
                    .gameId(m.getGameId())
                    .revision(m.getRevision())
                    .size(m.getByteSize())
                    .sha256(m.getSha256())
                    .updatedAt(m.getUpdatedAt())
                    .build();
        }
    }

    @Value
    @Builder
    public static class ConflictBody {
        long serverRevision;
        Instant serverUpdatedAt;
        String message;
    }
}
