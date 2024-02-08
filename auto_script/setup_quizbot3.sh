#!/bin/bash

# Function to display usage information
usage() {
    echo "Usage: $0 [--help] [--install-path=path] [--cron] [--dump=backup_file.sql] [--node=node_version(16,17,18)]"
    exit 1
}

# Variables
INSTALL_PATH=""
NODE_VERSION="16"
BACKUP_FILE=""
REGISTER_CRON=false

# Process parameters
while [ "$#" -gt 0 ]; do
    case "$1" in
		--install-path=*)
			INSTALL_PATH="${1#*=}"
			shift 1
			;;
        --node=*)
            NODE_VERSION="${1#*=}"
            shift 1
            ;;
		--cron)
            REGISTER_CRON=true
            shift 1
            ;;
		--dump=*)
			BACKUP_FILE="${1#*=}"
            shift 1
            ;;
        --help)
            usage
            ;;
        *)
            usage
            ;;
    esac
done

# Check if --install-path option is provided
if [ -n "$INSTALL_PATH" ]; then
	# Check if INSTALL_PATH is a valid directory
	if [ ! -d "$INSTALL_PATH" ]; then
		echo "Error: Invalid install path. Please provide a valid directory."
		exit 1
	fi
    echo "Install path set to: $INSTALL_PATH"
else
	echo "The --install-path parameter is required"
	exit 1
fi

# Check if --cron option is provided
echo "Register cron set to: $REGISTER_CRON"

# Check if --node option is provided
if [ -n "$NODE_VERSION" ]; then
    echo "Node version set to: $NODE_VERSION"
fi

# Check if --dump option is provided
if [ -n "$BACKUP_FILE" ]; then
	# Check if INSTALL_PATH is a valid directory
	if [ ! -f "$BACKUP_FILE" ]; then
		echo "Error: Invalid BACKUP_FILE path. Please provide a valid file."
		exit 1
	fi
    echo "Running with --dump option. Restoring database from backup file: $BACKUP_FILE"
fi

# Emphasized output function
print_emphasized() {
    echo -e "\e[1;32m$1\e[0m"
}

print_emphasized "Updating package list..."
sudo apt update

print_emphasized "Installing PostgreSQL 14..."
sudo apt install postgresql-14

print_emphasized "Creating user 'quizbot' with password 'changepasswd'..."
sudo -u postgres psql -c "CREATE USER quizbot WITH PASSWORD 'changepasswd';"

print_emphasized "Creating database 'quizbot3' owned by user 'quizbot'..."
sudo -u postgres psql -c "CREATE DATABASE quizbot3 WITH OWNER quizbot;"

#print_emphasized "Modifying pg_hba.conf to use md5 for all local peers..."
#sudo sed -i "s/local.*all.*peer/local all all md5/" /etc/postgresql/14/main/pg_hba.conf

print_emphasized "Allowing PostgreSQL to be accessible from outside..."
sudo sed -i "s/#listen_addresses = 'localhost'/listen_addresses = '*'/g" /etc/postgresql/14/main/postgresql.conf

print_emphasized "Restarting PostgreSQL for changes to take effect..."
sudo service postgresql restart

print_emphasized "Navigating to the home directory..."
cd ~

print_emphasized "Installing Node.js $NODE_VERSION.x..."
curl -sL https://deb.nodesource.com/setup_$NODE_VERSION.x | sudo bash -
sudo apt remove libnode-dev
sudo apt remove libnode72:amd64
sudo apt install nodejs -y

# If --dump option is provided, restore database from the specified backup file
if [ -n "$BACKUP_FILE" ]; then
    print_emphasized "Restoring database from the specified backup file: $BACKUP_FILE"
	cp $BACKUP_FILE /tmp
    sudo -u postgres psql -d quizbot3 -f "/tmp/$(basename "$BACKUP_FILE")"
	rm "/tmp/$(basename "$BACKUP_FILE")"
fi

print_emphasized "Modifying pg_hba.conf to use md5 for all local peers..."
sudo sed -i "s/local.*all.*peer/local all all md5/" /etc/postgresql/14/main/pg_hba.conf

# Install Quizbot3
print_emphasized "Installing Git"
sudo apt install git -y

print_emphasized "Installing Quizbot3 master"
sudo git clone https://github.com/OtterBK/Quizbot3.git $INSTALL_PATH
cd $INSTALL_PATH
sudo npm install
sudo cp -R custom_node_modules/* node_modules/
print_emphasized "Quizbot3 has been Installed!!!!!!!!!!!!!!!!!!!!"


# Setting Cron Scheduler
if [ "$REGISTER_CRON" = true ]; then
	print_emphasized "Installing Cron..."
        sudo timedatectl set-timezone Asia/Seoul
	sudo apt install cron -y
	sudo service cron start

	print_emphasized "Executing Register cron script"
 	(crontab -l 2>/dev/null; echo "CRON_TZ=Asia/Seoul") | crontab -
  
	(crontab -l 2>/dev/null; echo "0 * * * * sudo sh $SCRIPT_PATH/server_script/drop_ffmpeg.sh") | crontab -
	(crontab -l 2>/dev/null; echo "0 9,21 * * * sudo sh $SCRIPT_PATH/server_script/quizbot_stop.sh") | crontab -
	(crontab -l 2>/dev/null; echo "1 9,21 * * * sudo sh $SCRIPT_PATH/server_script/quizbot_start.sh") | crontab -

	(crontab -l 2>/dev/null; echo "0 0 * * 1 sudo sh $SCRIPT_PATH/db_script/reset_played_count_of_week.sh") | crontab -
	(crontab -l 2>/dev/null; echo "0 8 * * * sudo sh $SCRIPT_PATH/db_script/backup_script.sh") | crontab -
 	(crontab -l 2>/dev/null; echo "0 */3 * * * sudo sync && echo 3 > /proc/sys/vm/drop_caches") | crontab -
fi

print_emphasized "Quizbot3 Auto Setup Finised! :)"
