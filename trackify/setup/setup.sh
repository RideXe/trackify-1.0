#!/bin/sh

PRESERVECONFIG=0
if [ -f /opt/trackify/conf/trackify.xml ]
then
    cp /opt/trackify/conf/trackify.xml /opt/trackify/conf/trackify.xml.saved
    PRESERVECONFIG=1
fi

mkdir -p /opt/trackify
cp -r * /opt/trackify
chmod -R go+rX /opt/trackify

if [ ${PRESERVECONFIG} -eq 1 ] && [ -f /opt/trackify/conf/trackify.xml.saved ]
then
    mv -f /opt/trackify/conf/trackify.xml.saved /opt/trackify/conf/trackify.xml
fi

mv /opt/trackify/trackify.service /etc/systemd/system
chmod 664 /etc/systemd/system/trackify.service

systemctl daemon-reload
systemctl enable trackify.service

rm /opt/trackify/setup.sh
rm -r ../out
