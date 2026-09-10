package main

import (
	"fmt"
	"regexp"
	"testing"
)

func TestParseArmlinkRegionLine(t *testing.T) {
	line := "    Load Region LR_EXTFLASH (Base: 0x08900000, Size: 0x005d2b64, Max: 0x00700000, ABSOLUTE)"
	trimmed := trimSpaceLocal(line)
	t.Logf("trimmed=%q len=%d", trimmed, len(trimmed))
	re := regexp.MustCompile(`^\w+ Region\s+([^\s]+)\s+\((.+)\)$`)
	t.Logf("direct match: %v", re.FindStringSubmatch(trimmed))
	r := parseArmlinkRegionLine(trimmed)
	if r == nil {
		t.Fatalf("parseArmlinkRegionLine returned nil")
	}
	if r.name != "LR_EXTFLASH" || r.addr != 0x08900000 {
		t.Fatalf("unexpected values: %+v", r)
	}
}

func trimSpaceLocal(s string) string {
	out := s
	for len(out) > 0 && (out[0] == ' ' || out[0] == '\t') {
		out = out[1:]
	}
	for len(out) > 0 && (out[len(out)-1] == ' ' || out[len(out)-1] == '\t') {
		out = out[:len(out)-1]
	}
	return out
}

var _ = fmt.Sprintf
