package com.retroweb.api.save;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface SaveMetaRepository extends JpaRepository<SaveMeta, Long> {
    Optional<SaveMeta> findByUserIdAndGameId(String userId, String gameId);
    List<SaveMeta> findByUserIdOrderByUpdatedAtDesc(String userId);
}
