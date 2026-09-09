package main

// 有序 JSON:对齐 Newtonsoft JObject 的语义(键保序、ContainsKey、类型分派)。
// Go 原生 map 会按键排序,破坏模型/参数的字段顺序 → 命令行顺序不一致。

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

// JKind: 值种类
type JKind int

const (
	JNull JKind = iota
	JBool
	JNumber
	JString
	JArray
	JObject
)

// JVal: 任意 JSON 值
type JVal struct {
	Kind  JKind
	Bool  bool
	Num   float64
	Str   string
	Arr   []*JVal
	Obj   *JObj
}

// JObj: 保序对象
type JObj struct {
	keys []string
	vals map[string]*JVal
}

func NewJObj() *JObj { return &JObj{vals: map[string]*JVal{}} }

func (o *JObj) Has(key string) bool {
	_, ok := o.vals[key]
	return ok
}
func (o *JObj) Get(key string) *JVal { return o.vals[key] }
func (o *JObj) Keys() []string       { return o.keys }
func (o *JObj) Set(key string, v *JVal) {
	if _, ok := o.vals[key]; !ok {
		o.keys = append(o.keys, key)
	}
	o.vals[key] = v
}
func (o *JObj) AddFirst(key string, v *JVal) {
	if _, ok := o.vals[key]; ok {
		o.vals[key] = v
		return
	}
	o.keys = append([]string{key}, o.keys...)
	o.vals[key] = v
}
func (o *JObj) Len() int { return len(o.keys) }

func (o *JObj) Str(key string) string {
	if v := o.vals[key]; v != nil && v.Kind == JString {
		return v.Str
	}
	return ""
}
func (o *JObj) BoolOr(key string, def bool) bool {
	if v := o.vals[key]; v != nil && v.Kind == JBool {
		return v.Bool
	}
	return def
}
func (o *JObj) ObjOr(key string) *JObj {
	if v := o.vals[key]; v != nil && v.Kind == JObject {
		return v.Obj
	}
	return nil
}
func (o *JObj) ArrOr(key string) []*JVal {
	if v := o.vals[key]; v != nil && v.Kind == JArray {
		return v.Arr
	}
	return nil
}

func jvals2str(list []*JVal) []string {
	out := make([]string, 0, len(list))
	for _, item := range list {
		out = append(out, item.AsString())
	}
	return out
}

func (v *JVal) IsString() bool  { return v != nil && v.Kind == JString }
func (v *JVal) AsString() string {
	if v == nil {
		return ""
	}
	switch v.Kind {
	case JString:
		return v.Str
	case JBool:
		if v.Bool {
			return "true"
		}
		return "false"
	case JNumber:
		return strconv.FormatFloat(v.Num, 'f', -1, 64)
	}
	return ""
}

// ParseJVal: 用 json.Decoder 流式解析,保持对象键序。
func ParseJVal(data []byte) (*JVal, error) {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.UseNumber()
	v, err := decodeJVal(dec)
	if err != nil {
		return nil, err
	}
	// 尾部只允许空白
	if dec.More() {
		return nil, fmt.Errorf("trailing data after JSON value")
	}
	return v, nil
}

func decodeJVal(dec *json.Decoder) (*JVal, error) {
	tok, err := dec.Token()
	if err != nil {
		return nil, err
	}
	return decodeJToken(dec, tok)
}

func decodeJToken(dec *json.Decoder, tok json.Token) (*JVal, error) {
	switch t := tok.(type) {
	case json.Delim:
		switch t {
		case '{':
			obj := NewJObj()
			for dec.More() {
				keyTok, err := dec.Token()
				if err != nil {
					return nil, err
				}
				key, _ := keyTok.(string)
				val, err := decodeJVal(dec)
				if err != nil {
					return nil, err
				}
				obj.Set(key, val)
			}
			if _, err := dec.Token(); err != nil { // '}'
				return nil, err
			}
			return &JVal{Kind: JObject, Obj: obj}, nil
		case '[':
			arr := &JVal{Kind: JArray}
			for dec.More() {
				val, err := decodeJVal(dec)
				if err != nil {
					return nil, err
				}
				arr.Arr = append(arr.Arr, val)
			}
			if _, err := dec.Token(); err != nil { // ']'
				return nil, err
			}
			return arr, nil
		}
		return nil, fmt.Errorf("unexpected delim %v", t)
	case bool:
		return &JVal{Kind: JBool, Bool: t}, nil
	case json.Number:
		n, _ := t.Float64()
		return &JVal{Kind: JNumber, Num: n}, nil
	case string:
		return &JVal{Kind: JString, Str: t}, nil
	case nil:
		return &JVal{Kind: JNull}, nil
	}
	return nil, fmt.Errorf("unexpected token %v", tok)
}

// ValuesOfString: 数组值 → 字符串切片(C# Values<string>() 语义)。
func (v *JVal) ValuesOfString() []string {
	if v == nil || v.Kind != JArray {
		return nil
	}
	out := make([]string, 0, len(v.Arr))
	for _, item := range v.Arr {
		out = append(out, item.AsString())
	}
	return out
}

// MarshalCompact: 紧凑序列化(对齐 Newtonsoft 默认输出:无 HTML 转义、无缩进)。
func (o *JObj) MarshalCompact() []byte {
	var b strings.Builder
	o.writeCompact(&b)
	return []byte(b.String())
}

func writeCompactStr(b *strings.Builder, s string) {
	enc, _ := json.Marshal(s) // 标准字符串转义(路径不含 <>&,与 Newtonsoft 输出一致)
	b.Write(enc)
}

func (o *JObj) writeCompact(b *strings.Builder) {
	b.WriteByte('{')
	for i, k := range o.keys {
		if i > 0 {
			b.WriteByte(',')
		}
		writeCompactStr(b, k)
		b.WriteByte(':')
		o.vals[k].writeCompact(b)
	}
	b.WriteByte('}')
}

func (v *JVal) writeCompact(b *strings.Builder) {
	if v == nil {
		b.WriteString("null")
		return
	}
	switch v.Kind {
	case JNull:
		b.WriteString("null")
	case JBool:
		b.WriteString(strconv.FormatBool(v.Bool))
	case JNumber:
		b.WriteString(strconv.FormatFloat(v.Num, 'f', -1, 64))
	case JString:
		writeCompactStr(b, v.Str)
	case JArray:
		b.WriteByte('[')
		for i, item := range v.Arr {
			if i > 0 {
				b.WriteByte(',')
			}
			item.writeCompact(b)
		}
		b.WriteByte(']')
	case JObject:
		v.Obj.writeCompact(b)
	}
}
