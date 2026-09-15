package main

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"strings"
)

const (
	MaxHandshakeBytes = 512
)

var (
	ErrVarIntTooBig       = errors.New("varint is too big")
	ErrPacketTooLarge     = errors.New("packet length exceeds maximum allowed size")
	ErrInvalidPacketID    = errors.New("invalid packet id for handshake")
	ErrInvalidServerAddr  = errors.New("invalid server address in handshake")
	ErrInvalidNextState   = errors.New("invalid next state in handshake")
)

// ReadVarInt reads a Minecraft VarInt from the reader.
// Returns the int32 value, the total raw bytes read, and any error.
func ReadVarInt(r io.Reader) (int32, []byte, error) {
	var value uint32
	var position uint
	var rawBytes []byte
	buf := make([]byte, 1)

	for {
		_, err := io.ReadFull(r, buf)
		if err != nil {
			return 0, rawBytes, err
		}
		currentByte := buf[0]
		rawBytes = append(rawBytes, currentByte)

		value |= uint32(currentByte&0x7F) << position
		if (currentByte & 0x80) == 0 {
			break
		}

		position += 7
		if position >= 32 {
			return 0, rawBytes, ErrVarIntTooBig
		}
	}

	return int32(value), rawBytes, nil
}

// EncodeVarInt encodes an int32 value into standard Minecraft VarInt byte slice.
func EncodeVarInt(val int32) []byte {
	var buf []byte
	uval := uint32(val)
	for {
		b := byte(uval & 0x7F)
		uval >>= 7
		if uval != 0 {
			b |= 0x80
		}
		buf = append(buf, b)
		if uval == 0 {
			break
		}
	}
	return buf
}

// Handshake represents a parsed Minecraft Java Handshake packet.
type Handshake struct {
	ProtocolVersion int
	ServerAddress   string
	CleanHostname   string
	ServerPort      uint16
	NextState       int
	RawPacket       []byte
}

// ReadHandshake reads and parses a Handshake packet from a connection.
// It strictly enforces the 512-byte defense limit and preserves the full raw packet.
func ReadHandshake(r io.Reader) (*Handshake, error) {
	packetLen, lenBytes, err := ReadVarInt(r)
	if err != nil {
		return nil, fmt.Errorf("failed to read handshake packet length: %w", err)
	}

	if packetLen <= 0 || packetLen > MaxHandshakeBytes {
		return nil, ErrPacketTooLarge
	}

	body := make([]byte, packetLen)
	if _, err := io.ReadFull(r, body); err != nil {
		return nil, fmt.Errorf("failed to read handshake packet body: %w", err)
	}

	// Preserve the exact full raw packet bytes (length prefix + body)
	rawPacket := make([]byte, 0, len(lenBytes)+len(body))
	rawPacket = append(rawPacket, lenBytes...)
	rawPacket = append(rawPacket, body...)

	reader := bytes.NewReader(body)

	// 1. Packet ID (must be 0x00)
	packetID, _, err := ReadVarInt(reader)
	if err != nil {
		return nil, fmt.Errorf("failed to read packet ID: %w", err)
	}
	if packetID != 0x00 {
		return nil, ErrInvalidPacketID
	}

	// 2. Protocol Version (VarInt)
	protoVersion, _, err := ReadVarInt(reader)
	if err != nil {
		return nil, fmt.Errorf("failed to read protocol version: %w", err)
	}

	// 3. Server Address (VarInt length + UTF-8 string)
	addrLen, _, err := ReadVarInt(reader)
	if err != nil {
		return nil, fmt.Errorf("failed to read server address length: %w", err)
	}
	if addrLen < 0 || addrLen > 255 || int(addrLen) > reader.Len() {
		return nil, ErrInvalidServerAddr
	}

	addrBytes := make([]byte, addrLen)
	if _, err := io.ReadFull(reader, addrBytes); err != nil {
		return nil, fmt.Errorf("failed to read server address string: %w", err)
	}
	serverAddress := string(addrBytes)

	// Clean hostname: extract portion before first null byte (Forge/FML support)
	cleanHostname := strings.Split(serverAddress, "\x00")[0]

	// 4. Server Port (uint16 big-endian)
	var serverPort uint16
	if err := binary.Read(reader, binary.BigEndian, &serverPort); err != nil {
		return nil, fmt.Errorf("failed to read server port: %w", err)
	}

	// 5. Next State (VarInt: 1 for Status, 2 for Login)
	nextState, _, err := ReadVarInt(reader)
	if err != nil {
		return nil, fmt.Errorf("failed to read next state: %w", err)
	}
	if nextState != 1 && nextState != 2 {
		return nil, ErrInvalidNextState
	}

	return &Handshake{
		ProtocolVersion: int(protoVersion),
		ServerAddress:   serverAddress,
		CleanHostname:   cleanHostname,
		ServerPort:      serverPort,
		NextState:       int(nextState),
		RawPacket:       rawPacket,
	}, nil
}

// BuildLoginDisconnect generates the Minecraft Login Disconnect packet (Packet ID 0x00).
// Handles JSON Component format for protocol <= 764 (Java 1.7 to 1.20.2)
// and Anonymous Network NBT format for protocol >= 765 (Java 1.20.3+).
func BuildLoginDisconnect(protocolVersion int, message string) []byte {
	var body []byte

	if protocolVersion <= 764 {
		// Protocol <= 764: JSON Component String ({"text":"<mensaje>"})
		jsonPayload := fmt.Sprintf(`{"text":%q}`, message)
		jsonBytes := []byte(jsonPayload)
		lenVarInt := EncodeVarInt(int32(len(jsonBytes)))
		body = append(body, lenVarInt...)
		body = append(body, jsonBytes...)
	} else {
		// Protocol >= 765: Anonymous Network NBT Component
		// 0x0A: TAG_Compound (root anonymous tag)
		// 0x08: TAG_String
		// uint16 big-endian: length of tag name "text" (4)
		// []byte("text")
		// uint16 big-endian: length of message
		// []byte(message)
		// 0x00: TAG_End
		msgBytes := []byte(message)

		var nbt bytes.Buffer
		nbt.WriteByte(0x0A) // TAG_Compound
		nbt.WriteByte(0x08) // TAG_String

		nameBytes := []byte("text")
		_ = binary.Write(&nbt, binary.BigEndian, uint16(len(nameBytes)))
		nbt.Write(nameBytes)

		_ = binary.Write(&nbt, binary.BigEndian, uint16(len(msgBytes)))
		nbt.Write(msgBytes)

		nbt.WriteByte(0x00) // TAG_End

		body = nbt.Bytes()
	}

	// Packet ID 0x00 in Login state
	packetID := EncodeVarInt(0x00)

	packetPayload := append(packetID, body...)
	packetLength := EncodeVarInt(int32(len(packetPayload)))

	fullPacket := append(packetLength, packetPayload...)
	return fullPacket
}
