package main

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
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
	if _, err := reader.Read(jsonBytes); err != nil {
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
}

func TestBuildLoginDisconnectModernNBT(t *testing.T) {
	// Protocol >= 765: Anonymous Network NBT component format
	msg := "El servidor se está iniciando. Inténtalo nuevamente en unos segundos."
	pkt := BuildLoginDisconnect(765, msg)

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

	// Verify NBT structure:
	// 0x0A (TAG_Compound)
	b, _ := reader.ReadByte()
	if b != 0x0A {
		t.Fatalf("Expected TAG_Compound (0x0A), got 0x%02X", b)
	}

	// 0x08 (TAG_String)
	b, _ = reader.ReadByte()
	if b != 0x08 {
		t.Fatalf("Expected TAG_String (0x08), got 0x%02X", b)
	}

	// name length: 4
	var nameLen uint16
	_ = binary.Read(reader, binary.BigEndian, &nameLen)
	if nameLen != 4 {
		t.Fatalf("Expected name length 4, got %d", nameLen)
	}

	nameBuf := make([]byte, 4)
	_, _ = reader.Read(nameBuf)
	if string(nameBuf) != "text" {
		t.Fatalf("Expected name 'text', got %q", string(nameBuf))
	}

	// value length
	var valLen uint16
	_ = binary.Read(reader, binary.BigEndian, &valLen)
	if int(valLen) != len([]byte(msg)) {
		t.Fatalf("Expected value length %d, got %d", len([]byte(msg)), valLen)
	}

	valBuf := make([]byte, valLen)
	_, _ = reader.Read(valBuf)
	if string(valBuf) != msg {
		t.Fatalf("Expected message %q, got %q", msg, string(valBuf))
	}

	// 0x00 (TAG_End)
	b, _ = reader.ReadByte()
	if b != 0x00 {
		t.Fatalf("Expected TAG_End (0x00), got 0x%02X", b)
	}

	// Reader should now be exhausted
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
