box = InputBox(Wscript.Arguments.Item(1), Wscript.Arguments.Item(0), Wscript.Arguments.Item(2))

' Base64编码函数
Function Base64Encode(sText)
    Dim oXML, oNode
    Set oXML = CreateObject("Msxml2.DOMDocument.3.0")
    Set oNode = oXML.CreateElement("base64")
    oNode.dataType = "bin.base64"
    oNode.nodeTypedValue = Stream_StringToBinary(sText)
    Base64Encode = oNode.text
    Set oNode = Nothing
    Set oXML = Nothing
End Function

' 字符串转二进制流函数
Function Stream_StringToBinary(Text)
    Const adTypeText = 2
    Const adTypeBinary = 1
    Dim BinaryStream 'As New Stream
    Set BinaryStream = CreateObject("ADODB.Stream")
    BinaryStream.Type = adTypeText
    BinaryStream.CharSet = "utf-8"
    BinaryStream.Open
    BinaryStream.WriteText Text
    BinaryStream.Position = 0
    BinaryStream.Type = adTypeBinary
    BinaryStream.Position = 3 ' Skip BOM
    Stream_StringToBinary = BinaryStream.Read
    Set BinaryStream = Nothing
End Function

If IsNull(box) Then
    Wscript.Echo "RETURN"
Else
    Wscript.Echo "RETURN" + Base64Encode(box)
End If