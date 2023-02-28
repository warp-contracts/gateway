import Redis from "ioredis";

async function connect() {
  const publisher = new Redis({
      "port": 6379,
      "host": "dre-redis-master.dev.warp.cc",
      "username": "default",
      "password": "xzh0cMsGrg",
      "enableOfflineQueue": false,
      "lazyConnect": true,
      "tls": {
        "ca": ["-----BEGIN CERTIFICATE-----\n" +
        "MIIDEjCCAfqgAwIBAgIRAJ0RTS0Mu4/4Ko0WLuCu+GkwDQYJKoZIhvcNAQELBQAw\n" +
        "EzERMA8GA1UEAxMIcmVkaXMtY2EwHhcNMjMwMjAxMTAwMzIxWhcNMjQwMjAxMTAw\n" +
        "MzIxWjATMREwDwYDVQQDEwhyZWRpcy1jYTCCASIwDQYJKoZIhvcNAQEBBQADggEP\n" +
        "ADCCAQoCggEBAJsvqOGHgbTgJK7NwWaReOKuybbv04+UuOtWgc6Qd4pm9zKElXi+\n" +
        "+cfnqb0j6SUxV7FA293W2L8JAP9VmX+Sok22j1+6MmLWDogbtzL+bq8w21+1aU5C\n" +
        "qbkOKdMRJsY6PAmF4Aw5D9asEpLcgXgGOKi7KrIB6BVVTxv8kGIlwPTi9xoCX3ba\n" +
        "EwTfwf5IduhN98PuFn1vZoIhgsTDjN1xF0BaM+b6VWDx2fEtpPrXHDaSVe8vTNMO\n" +
        "iVoCPm4HaHl8l7dBYrUyb8z0FNv4cmXMNNaNIXZWeh9niOpyq3QP6hhApd5Bbg+z\n" +
        "aEgF2BFAreWYKolRkClueBzSioAnmBg6l9cCAwEAAaNhMF8wDgYDVR0PAQH/BAQD\n" +
        "AgKkMB0GA1UdJQQWMBQGCCsGAQUFBwMBBggrBgEFBQcDAjAPBgNVHRMBAf8EBTAD\n" +
        "AQH/MB0GA1UdDgQWBBSwDvpGWKNiWUKFh7k2iS+qonJ9hTANBgkqhkiG9w0BAQsF\n" +
        "AAOCAQEAJFlQYFlG7663uDvUvIxSIjreq7wRVpiMqAtOkgpqfYIQKr5ju0Oe1AaM\n" +
        "ILyiTAnCQj/q0AxNMAwz3g4nCoVa2Y6usO7KXrGJBjpk6IP/FvotnaFqzh6GoAAt\n" +
        "ud1R8ZfD2Kc4q8NdfpHOhQKnZNGo6q4lNpPAaJ8/iMiGLHhdfxFi3NiCngjJeSKd\n" +
        "bAxvsaDVG04QhRGKDSqFwBygiA4KDFGCuGjuSsLt6YYJ39L4PHGPS4MAzCSfA1sp\n" +
        "nYLXlAduuwwsyxi97n3QeqIRMNgXBt9zIGDiE7Be7CapXRdkQM5ufc3Q3W9h8l0K\n" +
        "4kGHe25a1tNDs/K7ZGvy393/DONGpQ==\n" +
        "-----END CERTIFICATE-----"],
        "checkServerIdentity": () => {
          return null;
        },
      }
    }
  );
  await publisher.connect();
}

connect().then(() => console.log('done'));