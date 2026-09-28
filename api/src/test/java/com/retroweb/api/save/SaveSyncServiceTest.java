package com.retroweb.api.save;

import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * 存档乐观锁核心逻辑测试
 */
class SaveSyncServiceTest {

    private SaveSyncService serviceWith(SaveMetaRepository repo, SaveBlobStore blobStore) {
        return new SaveSyncService(repo, blobStore);
    }

    private SaveBlobStore memoryBlob() {
        return new SaveBlobStore() {
            @Override
            public String put(String storageKey, byte[] payload) {
                return storageKey;
            }

            @Override
            public java.io.InputStream open(String storageKey) {
                return new java.io.ByteArrayInputStream(new byte[]{1});
            }

            @Override
            public void delete(String storageKey) {
            }
        };
    }

    @Test
    void firstUploadWithRevisionZeroSucceeds() {
        SaveMetaRepository repo = Mockito.mock(SaveMetaRepository.class);
        when(repo.findByUserIdAndGameId("u1", "g1")).thenReturn(Optional.empty());
        when(repo.save(any(SaveMeta.class))).thenAnswer(inv -> inv.getArgument(0));

        var svc = serviceWith(repo, memoryBlob());
        var meta = svc.save("u1", "g1", 0L, new byte[]{1, 2, 3});

        assertEquals(1L, meta.getRevision());
        assertEquals(3, meta.getSize());
    }

    @Test
    void staleRevisionThrowsConflict() {
        SaveMeta existing = SaveMeta.builder()
                .userId("u1")
                .gameId("g1")
                .revision(1L)
                .byteSize(1)
                .sha256("aa")
                .storageKey("saves/u1/g1/1.sav")
                .build();

        SaveMetaRepository repo = Mockito.mock(SaveMetaRepository.class);
        when(repo.findByUserIdAndGameId("u1", "g1")).thenReturn(Optional.of(existing));

        var svc = serviceWith(repo, memoryBlob());
        var ex = assertThrows(RevisionConflictException.class,
                () -> svc.save("u1", "g1", 0L, new byte[]{9}));

        assertEquals(1L, ex.getServerRevision());
    }

    @Test
    void emptyPayloadRejected() {
        var svc = serviceWith(Mockito.mock(SaveMetaRepository.class), memoryBlob());
        assertThrows(IllegalArgumentException.class,
                () -> svc.save("u1", "g1", 0L, new byte[0]));
    }

    @Test
    void oversizedPayloadRejected() {
        var svc = serviceWith(Mockito.mock(SaveMetaRepository.class), memoryBlob());
        byte[] big = new byte[SaveSyncService.MAX_SAVE_BYTES + 1];
        assertThrows(IllegalArgumentException.class,
                () -> svc.save("u1", "g1", 0L, big));
    }
}
