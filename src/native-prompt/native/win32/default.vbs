box = InputBox(Wscript.Arguments.Item(1), Wscript.Arguments.Item(0), Wscript.Arguments.Item(2))

' URL编码函数 (UTF-8)
Function URLEncode(sText)
    Dim utf8Bytes, i, result
    result = ""
    
    ' 将字符串转换为UTF-8字节数组
    utf8Bytes = StringToUTF8Bytes(sText)
    
    ' 对每个字节进行URL编码
    For i = 0 To UBound(utf8Bytes)
        If IsUnreservedChar(utf8Bytes(i)) Then
            result = result + Chr(utf8Bytes(i))
        Else
            result = result + "%" + Right("0" + Hex(utf8Bytes(i)), 2)
        End If
    Next
    
    URLEncode = result
End Function

' 将字符串转换为UTF-8字节数组
Function StringToUTF8Bytes(sText)
    Dim stream, bytes
    Set stream = CreateObject("ADODB.Stream")
    stream.Type = 2 ' adTypeText
    stream.Charset = "UTF-8"
    stream.Open
    stream.WriteText sText
    stream.Position = 0
    stream.Type = 1 ' adTypeBinary
    stream.Position = 3 ' 跳过BOM
    bytes = stream.Read
    stream.Close
    Set stream = Nothing
    
    ' 将二进制数据转换为字节数组
    Dim byteArray(), i
    ReDim byteArray(LenB(bytes) - 1)
    For i = 0 To LenB(bytes) - 1
        byteArray(i) = AscB(MidB(bytes, i + 1, 1))
    Next
    
    StringToUTF8Bytes = byteArray
End Function

' 检查字节是否为不需要编码的字符
Function IsUnreservedChar(byteValue)
    ' RFC 3986: unreserved = ALPHA / DIGIT / "-" / "." / "_" / "~"
    IsUnreservedChar = (byteValue >= 65 And byteValue <= 90) Or _
                       (byteValue >= 97 And byteValue <= 122) Or _
                       (byteValue >= 48 And byteValue <= 57) Or _
                       byteValue = 45 Or byteValue = 46 Or byteValue = 95 Or byteValue = 126
End Function

If IsNull(box) Then
    Wscript.Echo "RETURN"
Else
    Wscript.Echo "RETURN" + URLEncode(box)
End If