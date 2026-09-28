package com.retroweb.api.save;

import lombok.Getter;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/**
 * 版本冲突：客户端 revision 与服务端不一致
 */
@Getter
public class RevisionConflictException extends ResponseStatusException {

    private final long serverRevision;

    public RevisionConflictException(long serverRevision) {
        super(HttpStatus.CONFLICT, "save revision conflict: server=" + serverRevision);
        this.serverRevision = serverRevision;
    }
}
