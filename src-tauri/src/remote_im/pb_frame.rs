//! Minimal protobuf codec for Feishu long-connection `pbbp2.Frame`.
//! Ported from @larksuiteoapi/node-sdk wire layout (no prost dependency).

#[derive(Debug, Clone, Default)]
pub struct Header {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Default)]
pub struct Frame {
    pub seq_id: u64,
    pub log_id: u64,
    pub service: i32,
    pub method: i32,
    pub headers: Vec<Header>,
    pub payload_encoding: Option<String>,
    pub payload_type: Option<String>,
    pub payload: Option<Vec<u8>>,
    pub log_id_new: Option<String>,
}

pub fn encode_frame(frame: &Frame) -> Vec<u8> {
    let mut out = Vec::with_capacity(128);
    write_varint_key(&mut out, 1, 0);
    write_varint_u64(&mut out, frame.seq_id);
    write_varint_key(&mut out, 2, 0);
    write_varint_u64(&mut out, frame.log_id);
    write_varint_key(&mut out, 3, 0);
    write_varint_u64(&mut out, frame.service as u64);
    write_varint_key(&mut out, 4, 0);
    write_varint_u64(&mut out, frame.method as u64);
    for h in &frame.headers {
        let mut body = Vec::new();
        write_string_field(&mut body, 1, &h.key);
        write_string_field(&mut body, 2, &h.value);
        write_bytes_field(&mut out, 5, &body);
    }
    if let Some(ref s) = frame.payload_encoding {
        write_string_field(&mut out, 6, s);
    }
    if let Some(ref s) = frame.payload_type {
        write_string_field(&mut out, 7, s);
    }
    if let Some(ref b) = frame.payload {
        write_bytes_field(&mut out, 8, b);
    }
    if let Some(ref s) = frame.log_id_new {
        write_string_field(&mut out, 9, s);
    }
    out
}

pub fn decode_frame(buf: &[u8]) -> Result<Frame, String> {
    let mut r = Reader::new(buf);
    let mut frame = Frame::default();
    while r.remaining() > 0 {
        let key = r.varint_u64()?;
        let field = (key >> 3) as u32;
        let wire = (key & 7) as u8;
        match (field, wire) {
            (1, 0) => frame.seq_id = r.varint_u64()?,
            (2, 0) => frame.log_id = r.varint_u64()?,
            (3, 0) => frame.service = r.varint_u64()? as i32,
            (4, 0) => frame.method = r.varint_u64()? as i32,
            (5, 2) => {
                let b = r.bytes()?;
                frame.headers.push(decode_header(&b)?);
            }
            (6, 2) => frame.payload_encoding = Some(r.string()?),
            (7, 2) => frame.payload_type = Some(r.string()?),
            (8, 2) => frame.payload = Some(r.bytes()?),
            (9, 2) => frame.log_id_new = Some(r.string()?),
            (_, w) => r.skip(w)?,
        }
    }
    Ok(frame)
}

fn decode_header(buf: &[u8]) -> Result<Header, String> {
    let mut r = Reader::new(buf);
    let mut h = Header::default();
    while r.remaining() > 0 {
        let key = r.varint_u64()?;
        let field = (key >> 3) as u32;
        let wire = (key & 7) as u8;
        match (field, wire) {
            (1, 2) => h.key = r.string()?,
            (2, 2) => h.value = r.string()?,
            (_, w) => r.skip(w)?,
        }
    }
    Ok(h)
}

fn write_varint_key(out: &mut Vec<u8>, field: u32, wire: u8) {
    write_varint_u64(out, ((field as u64) << 3) | (wire as u64));
}

fn write_varint_u64(out: &mut Vec<u8>, mut v: u64) {
    while v >= 0x80 {
        out.push((v as u8) | 0x80);
        v >>= 7;
    }
    out.push(v as u8);
}

fn write_string_field(out: &mut Vec<u8>, field: u32, s: &str) {
    write_bytes_field(out, field, s.as_bytes());
}

fn write_bytes_field(out: &mut Vec<u8>, field: u32, b: &[u8]) {
    write_varint_key(out, field, 2);
    write_varint_u64(out, b.len() as u64);
    out.extend_from_slice(b);
}

struct Reader<'a> {
    buf: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn new(buf: &'a [u8]) -> Self {
        Self { buf, pos: 0 }
    }
    fn remaining(&self) -> usize {
        self.buf.len().saturating_sub(self.pos)
    }
    fn varint_u64(&mut self) -> Result<u64, String> {
        let mut x = 0u64;
        let mut s = 0u32;
        loop {
            if self.pos >= self.buf.len() {
                return Err("truncated varint".into());
            }
            let b = self.buf[self.pos];
            self.pos += 1;
            if b < 0x80 {
                return Ok(x | ((b as u64) << s));
            }
            x |= ((b as u64) & 0x7f) << s;
            s += 7;
            if s > 63 {
                return Err("varint overflow".into());
            }
        }
    }
    fn bytes(&mut self) -> Result<Vec<u8>, String> {
        let n = self.varint_u64()? as usize;
        if self.pos + n > self.buf.len() {
            return Err("truncated bytes".into());
        }
        let out = self.buf[self.pos..self.pos + n].to_vec();
        self.pos += n;
        Ok(out)
    }
    fn string(&mut self) -> Result<String, String> {
        let b = self.bytes()?;
        String::from_utf8(b).map_err(|e| e.to_string())
    }
    fn skip(&mut self, wire: u8) -> Result<(), String> {
        match wire {
            0 => {
                let _ = self.varint_u64()?;
                Ok(())
            }
            1 => {
                if self.pos + 8 > self.buf.len() {
                    return Err("skip64".into());
                }
                self.pos += 8;
                Ok(())
            }
            2 => {
                let _ = self.bytes()?;
                Ok(())
            }
            5 => {
                if self.pos + 4 > self.buf.len() {
                    return Err("skip32".into());
                }
                self.pos += 4;
                Ok(())
            }
            _ => Err(format!("unknown wire {wire}")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_ping_frame() {
        let f = Frame {
            seq_id: 0,
            log_id: 0,
            service: 1,
            method: 0,
            headers: vec![Header {
                key: "type".into(),
                value: "ping".into(),
            }],
            ..Default::default()
        };
        let enc = encode_frame(&f);
        let dec = decode_frame(&enc).unwrap();
        assert_eq!(dec.service, 1);
        assert_eq!(dec.method, 0);
        assert_eq!(dec.headers[0].value, "ping");
    }
}
