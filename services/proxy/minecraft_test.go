package main

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"io"
	"strings"
	"testing"
)

func TestVarIntEncodingDecoding(t *testing.T) {
	testCases := []int32{
		0,
		1,
		2,
		127,
		128,
		255,
		25565,
		2097151,
		2147483647,
		-1,
		-2147483648,
	}

	for _, val := range testCases {
		encoded := EncodeVarInt(val)
		decoded, readBytes, err := ReadVarInt(bytes.NewReader(encoded))
		if err != nil {
			t.Fatalf("Failed to decode VarInt %d: %v", val, err)
		}
		if decoded != val {
			t.Errorf("VarInt mismatch: expected %d, got %d", val, decoded)
		}
		if len(readBytes) != len(encoded) {
			t.Errorf("VarInt length mismatch: expected %d, got %d", len(encoded), len(readBytes))
		}
	}
}

func TestVarIntTooBig(t *testing.T) {
	// 6 bytes with MSB set = invalid VarInt
	badBytes := []byte{0x80, 0x80, 0x80, 0x80, 0x80, 0x80}
	_, _, err := ReadVarInt(bytes.NewReader(badBytes))
	if err != ErrVarIntTooBig {
		t.Fatalf("Expected ErrVarIntTooBig, got %v", err)
	}
}

func buildRawHandshake(protoVersion int32, addr string, port uint16, nextState int32) []byte {
	var body bytes.Buffer
	// Packet ID 0x00
	body.Write(EncodeVarInt(0x00))
	// Protocol Version
	body.Write(EncodeVarInt(protoVersion))
	// Server Address
	addrBytes := []byte(addr)
	body.Write(EncodeVarInt(int32(len(addrBytes))))
	body.Write(addrBytes)
	// Server Port
	_ = binary.Write(&body, binary.BigEndian, port)
	// Next State
	body.Write(EncodeVarInt(nextState))

	payload := body.Bytes()
	packetLen := EncodeVarInt(int32(len(payload)))

	var packet []byte
	packet = append(packet, packetLen...)
	packet = append(packet, payload...)
	return packet
}

func TestReadHandshakeStandard(t *testing.T) {
	raw := buildRawHandshake(765, "play-meliora.hikat.org", 25565, 2)
	hs, err := ReadHandshake(bytes.NewReader(raw))
	if err != nil {
		t.Fatalf("ReadHandshake failed: %v", err)
	}

	if hs.ProtocolVersion != 765 {
		t.Errorf("Expected protocol 765, got %d", hs.ProtocolVersion)
	}
	if hs.ServerAddress != "play-meliora.hikat.org" {
		t.Errorf("Expected serverAddress play-meliora.hikat.org, got %s", hs.ServerAddress)
	}
	if hs.CleanHostname != "play-meliora.hikat.org" {
		t.Errorf("Expected cleanHostname play-meliora.hikat.org, got %s", hs.CleanHostname)
	}
	if hs.ServerPort != 25565 {
		t.Errorf("Expected port 25565, got %d", hs.ServerPort)
	}
	if hs.NextState != 2 {
		t.Errorf("Expected nextState 2, got %d", hs.NextState)
	}
	if !bytes.Equal(hs.RawPacket, raw) {
		t.Errorf("RawPacket was not preserved identically")
	}
}

func TestReadHandshakeForgeFML(t *testing.T) {
	// Forge client appending \0FML\0
	forgeAddr := "play-meliora.hikat.org\x00FML\x00"
	raw := buildRawHandshake(340, forgeAddr, 25565, 1)

	hs, err := ReadHandshake(bytes.NewReader(raw))
	if err != nil {
		t.Fatalf("ReadHandshake failed: %v", err)
	}

	if hs.ServerAddress != forgeAddr {
		t.Errorf("Expected full ServerAddress %q, got %q", forgeAddr, hs.ServerAddress)
	}
	if hs.CleanHostname != "play-meliora.hikat.org" {
		t.Errorf("Expected cleanHostname 'play-meliora.hikat.org', got %q", hs.CleanHostname)
	}
	if hs.NextState != 1 {
		t.Errorf("Expected nextState 1, got %d", hs.NextState)
	}
	// RawPacket must preserve the entire Forge marker intact for forwarding
	if !bytes.Equal(hs.RawPacket, raw) {
		t.Errorf("RawPacket with FML markers was not preserved identically")
	}
}

func TestReadHandshakePacketExceeds512Bytes(t *testing.T) {
	// Build packet length > 512
	fakeLongBody := make([]byte, 513)
	packetLen := EncodeVarInt(int32(len(fakeLongBody)))
	raw := append(packetLen, fakeLongBody...)

	_, err := ReadHandshake(bytes.NewReader(raw))
	if err != ErrPacketTooLarge {
		t.Fatalf("Expected ErrPacketTooLarge, got %v", err)
	}
}

func TestReadHandshakeInvalidPacketID(t *testing.T) {
	var body bytes.Buffer
	body.Write(EncodeVarInt(0x01)) // wrong packet ID, must be 0x00
	body.Write(EncodeVarInt(765))
	body.Write(EncodeVarInt(4))
	body.WriteString("test")
	_ = binary.Write(&body, binary.BigEndian, uint16(25565))
	body.Write(EncodeVarInt(2))

	payload := body.Bytes()
	raw := append(EncodeVarInt(int32(len(payload))), payload...)

	_, err := ReadHandshake(bytes.NewReader(raw))
	if err != ErrInvalidPacketID {
		t.Fatalf("Expected ErrInvalidPacketID, got %v", err)
	}
}

func TestReadHandshakeInvalidNextState(t *testing.T) {
	raw := buildRawHandshake(765, "play-meliora.hikat.org", 25565, 3) // nextState 3 is invalid
	_, err := ReadHandshake(bytes.NewReader(raw))
	if err != ErrInvalidNextState {
		t.Fatalf("Expected ErrInvalidNextState, got %v", err)
	}
}

func TestBuildLoginDisconnectLegacyJSON(t *testing.T) {
	// Protocol <= 764: JSON string component format
	msg := "El servidor se está iniciando. Inténtalo nuevamente en unos segundos."
	pkt := BuildLoginDisconnect(764, msg)

	reader := bytes.NewReader(pkt)
	pktLen, _, err := ReadVarInt(reader)
	if err != nil {
		t.Fatalf("Failed to read packet length: %v", err)
	}
	if int(pktLen) != reader.Len() {
		t.Errorf("Packet length mismatch: declared %d, remaining %d", pktLen, reader.Len())
	}

	pktID, _, err := ReadVarInt(reader)
	if err != nil || pktID != 0x00 {
		t.Fatalf("Expected packet ID 0x00, got %d (err: %v)", pktID, err)
	}

	// Read string length VarInt
	strLen, _, err := ReadVarInt(reader)
	if err != nil {
		t.Fatalf("Failed to read JSON string length: %v", err)
	}

	jsonBytes := make([]byte, strLen)
	if _, err := io.ReadFull(reader, jsonBytes); err != nil {
		t.Fatalf("Failed to read JSON bytes: %v", err)
	}

	expectedJSON := `{"text":"` + msg + `"}`
	if string(jsonBytes) != expectedJSON {
		t.Errorf("Expected JSON %q, got %q", expectedJSON, string(jsonBytes))
	}

	// Validate JSON contains no extra backslashes
	if strings.Contains(string(jsonBytes), `\`) {
		t.Errorf("Expected clean JSON without backslashes, got %s", string(jsonBytes))
	}

	// Validate it unmarshals into standard Chat component
	var parsed struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal(jsonBytes, &parsed); err != nil {
		t.Fatalf("Failed to parse JSON disconnect message: %v", err)
	}
	if parsed.Text != msg {
		t.Errorf("Expected parsed text %q, got %q", msg, parsed.Text)
	}

	// Verify no extra bytes remain
	if reader.Len() != 0 {
		t.Errorf("Expected 0 bytes remaining after reading string, got %d", reader.Len())
	}
}

func TestBuildLoginDisconnectModernProtocols(t *testing.T) {
	// Protocols 765 (1.20.3) and 767 (1.21.1) must also use Minecraft String + JSON Text Component
	protocols := []int{765, 767}
	msg := "El servidor se acaba de iniciar. Inténtalo nuevamente en unos segundos."

	for _, proto := range protocols {
		pkt := BuildLoginDisconnect(proto, msg)

		reader := bytes.NewReader(pkt)

		// 1. Packet length VarInt
		pktLen, _, err := ReadVarInt(reader)
		if err != nil {
			t.Fatalf("[proto %d] Failed to read packet length: %v", proto, err)
		}
		if int(pktLen) != reader.Len() {
			t.Errorf("[proto %d] Packet length mismatch: declared %d, remaining %d", proto, pktLen, reader.Len())
		}

		// 2. Packet ID 0x00
		pktID, _, err := ReadVarInt(reader)
		if err != nil || pktID != 0x00 {
			t.Fatalf("[proto %d] Expected packet ID 0x00, got %d (err: %v)", proto, pktID, err)
		}

		// 3. String length VarInt
		strLen, _, err := ReadVarInt(reader)
		if err != nil {
			t.Fatalf("[proto %d] Failed to read string length: %v", proto, err)
		}

		// 4. JSON bytes
		jsonBytes := make([]byte, strLen)
		if _, err := io.ReadFull(reader, jsonBytes); err != nil {
			t.Fatalf("[proto %d] Failed to read JSON bytes: %v", proto, err)
		}

		// 5. Unmarshal and verify text == message
		var parsed struct {
			Text string `json:"text"`
		}
		if err := json.Unmarshal(jsonBytes, &parsed); err != nil {
			t.Fatalf("[proto %d] Failed to unmarshal JSON disconnect string: %v", proto, err)
		}
		if parsed.Text != msg {
			t.Errorf("[proto %d] Expected text %q, got %q", proto, msg, parsed.Text)
		}

		// 6. Verify that after reading the string NO extra bytes remain
		if reader.Len() != 0 {
			t.Errorf("[proto %d] Expected 0 extra bytes remaining, got %d", proto, reader.Len())
		}
	}
}

func TestBuildLoginDisconnectSpecialCharacters(t *testing.T) {
	// Verify messages with quotes, backslashes, and accents are properly serialized
	msg := `Mensaje con "comillas", barras \ y tildes: éxito!`
	pkt := BuildLoginDisconnect(767, msg)

	reader := bytes.NewReader(pkt)
	pktLen, _, err := ReadVarInt(reader)
	if err != nil || int(pktLen) != reader.Len() {
		t.Fatalf("Packet length error: %v", err)
	}

	pktID, _, err := ReadVarInt(reader)
	if err != nil || pktID != 0x00 {
		t.Fatalf("Packet ID error: %v", err)
	}

	strLen, _, err := ReadVarInt(reader)
	if err != nil {
		t.Fatalf("String length error: %v", err)
	}

	jsonBytes := make([]byte, strLen)
	if _, err := io.ReadFull(reader, jsonBytes); err != nil {
		t.Fatalf("Read string error: %v", err)
	}

	var parsed struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal(jsonBytes, &parsed); err != nil {
		t.Fatalf("Failed unmarshaling JSON with special characters: %v (raw: %s)", err, string(jsonBytes))
	}
	if parsed.Text != msg {
		t.Errorf("Expected %q, got %q", msg, parsed.Text)
	}

	if reader.Len() != 0 {
		t.Errorf("Expected 0 bytes left, got %d", reader.Len())
	}
}

func TestCleanHostnameEdgeCases(t *testing.T) {
	testCases := []struct {
		input    string
		expected string
	}{
		{"play-meliora.hikat.org", "play-meliora.hikat.org"},
		{"play-meliora.hikat.org\x00FML\x00", "play-meliora.hikat.org"},
		{"play-meliora.hikat.org\x00FML2\x00", "play-meliora.hikat.org"},
		{"play-meliora.hikat.org\x00FML3\x00", "play-meliora.hikat.org"},
		{"play-test.hikat.org\x00extra", "play-test.hikat.org"},
	}

	for _, tc := range testCases {
		clean := strings.Split(tc.input, "\x00")[0]
		if clean != tc.expected {
			t.Errorf("For input %q, expected %q, got %q", tc.input, tc.expected, clean)
		}
	}
}

func TestBuildLoginDisconnectTranslation(t *testing.T) {
	protocols := []int{47, 340, 498, 754, 765, 767}
	keys := []string{
		"The server is starting. Please try again in a few seconds.",
		"The server is shutting down. Please try again in a few seconds.",
		"The server is online, but is not accepting connections right now. Please try again in a few seconds.",
		"The server is not available right now.",
	}

	for _, proto := range protocols {
		for _, key := range keys {
			pkt := BuildLoginDisconnectTranslation(proto, key)

			reader := bytes.NewReader(pkt)

			// 1. Packet length VarInt
			pktLen, _, err := ReadVarInt(reader)
			if err != nil {
				t.Fatalf("[proto %d, key %q] Failed to read packet length: %v", proto, key, err)
			}
			if int(pktLen) != reader.Len() {
				t.Errorf("[proto %d, key %q] Packet length mismatch: declared %d, remaining %d", proto, key, pktLen, reader.Len())
			}

			// 2. Packet ID 0x00
			pktID, _, err := ReadVarInt(reader)
			if err != nil || pktID != 0x00 {
				t.Fatalf("[proto %d, key %q] Expected packet ID 0x00, got %d (err: %v)", proto, key, pktID, err)
			}

			// 3. String length VarInt
			strLen, _, err := ReadVarInt(reader)
			if err != nil {
				t.Fatalf("[proto %d, key %q] Failed to read string length: %v", proto, key, err)
			}

			// 4. JSON bytes
			jsonBytes := make([]byte, strLen)
			if _, err := io.ReadFull(reader, jsonBytes); err != nil {
				t.Fatalf("[proto %d, key %q] Failed to read JSON bytes: %v", proto, key, err)
			}

			// 5. Valid JSON with translate present and text absent
			var rawMap map[string]interface{}
			if err := json.Unmarshal(jsonBytes, &rawMap); err != nil {
				t.Fatalf("[proto %d, key %q] Invalid JSON: %v, raw: %s", proto, key, err, string(jsonBytes))
			}

			if _, hasText := rawMap["text"]; hasText {
				t.Errorf("[proto %d, key %q] Field 'text' must be absent, got %v", proto, key, rawMap["text"])
			}

			translateVal, hasTranslate := rawMap["translate"]
			if !hasTranslate {
				t.Errorf("[proto %d, key %q] Field 'translate' must be present", proto, key)
			} else if translateVal != key {
				t.Errorf("[proto %d, key %q] Expected translate %q, got %q", proto, key, key, translateVal)
			}

			// 6. No trailing bytes
			if reader.Len() != 0 {
				t.Errorf("[proto %d, key %q] Expected 0 trailing bytes, got %d", proto, key, reader.Len())
			}
		}
	}
}

