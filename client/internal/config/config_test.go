package config

import "testing"

func TestSecureBase(t *testing.T) {
	ok := []string{
		"https://earnd.example.com",
		"https://earnd.example.com:8443/api",
		"http://localhost:3000",
		"http://127.0.0.1:3000",
		"http://[::1]:3000",
	}
	for _, b := range ok {
		if err := SecureBase(b); err != nil {
			t.Errorf("SecureBase(%q) = %v, want nil", b, err)
		}
	}
	bad := []string{
		"http://earnd.example.com", // plaintext non-loopback
		"http://192.168.1.10:3000", // plaintext LAN host
		"ftp://earnd.example.com",  // wrong scheme
		"earnd.example.com",        // no scheme
	}
	for _, b := range bad {
		if err := SecureBase(b); err == nil {
			t.Errorf("SecureBase(%q) = nil, want error", b)
		}
	}
}
