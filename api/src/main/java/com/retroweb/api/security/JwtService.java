package com.retroweb.api.security;

import io.jsonwebtoken.Jwts;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.time.Instant;
import java.util.Date;

/**
 * JWT 签发工具
 */
@Service
public class JwtService {

    private final SecretKey secretKey;

    public JwtService(SecretKey secretKey) {
        this.secretKey = secretKey;
    }

    public String issueToken(String userId, DurationLike ttl) {
        Instant now = Instant.now();
        return Jwts.builder()
                .subject(userId)
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plusSeconds(ttl.seconds())))
                .signWith(secretKey)
                .compact();
    }

    /** 简单 TTL 包装，避免在骨架里引入额外依赖 */
    public record DurationLike(long seconds) {
        public static DurationLike hours(int h) {
            return new DurationLike(h * 3600L);
        }
    }
}
